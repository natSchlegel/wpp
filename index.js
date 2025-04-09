import mysql from "mysql2/promise";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, chatModificationToAppPatch } from "baileys";
import qrcode from "qrcode-terminal";
import moment from "moment";
import cron from "node-cron";
import dotenv from "dotenv";


dotenv.config();

let sock;
const userStates = {};

global.week = moment().isoWeek();
global.nextWeek = moment().add(1, 'week').isoWeek();
global.year = moment().isoWeekYear();

const db = mysql.createPool({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
});

const controlPanel = async () => {
	console.log("Control Panel is running... now");

	cron.schedule("0 8 * * 1", async () => {
		await assignTasks();
		await sendMessage(process.env.ADMIN_NUMBER, "🗓️ Assigning tasks for the new week on Monday at 8 AM...", "contact");
	});

	cron.schedule("0 10 * * 3", async () => {
		await requestConfirmation();
		await sendMessage(process.env.ADMIN_NUMBER, "🔔 Requesting confirmation for assigned tasks for the next week on Wednesday at 10 AM...", "contact");

	});

	cron.schedule("0 10 * * 5", async () => {
		await remindPendingTasks();
		await sendMessage(process.env.ADMIN_NUMBER, "🔔 Reminding pending task reminders for the next week on Friday at 10 AM...", "contact");
	});

	cron.schedule("0 8 * * 6", async () => {
		await checkAndReassignPendingTasks();
		await sendMessage(process.env.ADMIN_NUMBER, "🔄 Checking for pending tasks on Saturday morning at 8 AM...", "contact");

	});

	cron.schedule("0 8 * * 0", async () => {
		await messageIfPending();
		await sendMessage(process.env.ADMIN_NUMBER, "🔄 Messaging groupchat if there is still pending tasks for the next week on Sunday at 8 AM", "contact");

	});

	cron.schedule("0 8 * * 0", async () => {
		await taskCompleteMessage();
		await sendMessage(process.env.ADMIN_NUMBER, "🔄 Messaging private contact if task was completed on Sunday at 8 AM", "contact");

	});



	console.log("Cron jobs scheduled and running in the background.");
};

const connectToWhatsApp = async () => {
	return new Promise(async (resolve, reject) => {
		try {
			const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

			sock = makeWASocket({
				auth: state,
				printQRInTerminal: false,
				getMessage: async (key) => {
					try {
						return sock?.store?.loadMessage(key.remoteJid, key.id) || null;
					} catch (error) {
						console.error("Error in getMessage:", error);
						return null;
					}
				}
			});

			sock.ev.on("creds.update", saveCreds);

			sock.ev.on("connection.update", (update) => {
				const { connection, lastDisconnect, qr } = update;

				if (qr) {
					qrcode.generate(qr, { small: true });
				}

				if (connection === "close") {
					const shouldReconnect =
						lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
					console.log("DisconnectReason:" + DisconnectReason.loggedOut);
					if (shouldReconnect) {
						console.log("Connection closed. Reconnecting...");
						setTimeout(connectToWhatsApp, 5000);
					} else {
						console.log("Connection closed due to logout. Please re-scan QR code.");
					}
				} else if (connection === "open") {
					console.log("Successfully connected to WhatsApp");
					resolve();
				}
			});


			sock.ev.on("messages.upsert", async (m) => {
				if (!m.messages[0].message) return;
				const message = m.messages[0];
				const phoneNumber = message.key.remoteJid.replace("@s.whatsapp.net", "");
				const text = message.message.conversation?.toLowerCase();

				const [user] = await db.query(
					"SELECT id FROM users WHERE phone_number = ?",
					[phoneNumber]
				);

				if (!user.length) {
					// sendMessage(process.env.ADMIN_NUMBER, text, "contact")
				}
				else {
					await handleUserResponse(sock, user[0].id, text);
				}
			});


		} catch (error) {
			console.error("Error in connectToWhatsApp:", error);
			reject(error);
		}
	});
}

async function checkAndReassignPendingTasks() {

	const [pendingTasks] = await db.query(
		`SELECT wa.*, t.task_name FROM weekly_assignments wa JOIN tasks t ON wa.task_id = t.id WHERE wa.status = 'pending' AND wa.assigned_week = ? AND wa.year = ?;`, [global.nextWeek, global.year]
	);

	if (pendingTasks.length === 0) {
		console.log("✅ No pending tasks found.");
		return;
	}

	for (const task of pendingTasks) {
		console.log(`🔄 Declining task ${task.task_id}...`);
		await declineTask(task, global.nextWeek, global.year);
	}

	for (const task of pendingTasks) {
		console.log(`🔄 Reassigning task ${task.task_id}...`);
		await reassignTask(task, global.nextWeek, global.year);
	}
}

async function taskCompleteMessage() {
	const [confirmedTasks] = await db.query(
		`SELECT 
			wa.task_id, 
			t.task_name AS taskName, 
			u.name AS userName, 
			u.phone_number AS phoneNumber 
		FROM weekly_assignments wa 
		JOIN users u ON wa.user_id = u.id 
		JOIN tasks t ON wa.task_id = t.id 
		WHERE wa.assigned_week = ? AND wa.year = ? AND wa.status = 'confirmed'`,
		[global.week, global.year]
	);

	for (const task of confirmedTasks) {
		const message = `Hallo ${task.userName}! 😊\nDiese Woche warst du für die Aufgabe *${task.taskName}* zuständig.\nHast du sie erledigt? Bitte antworte mit *erledigt* oder *unerledigt*.`;
		await sendMessage(task.phoneNumber, message, "contact");
		// console.log("Message sent to: " + task.userName + " for task: " + task.taskName + " on number: " + task.phoneNumber)
	}
}


async function remindPendingTasks() {

	const [pendingTasks] = await db.query(
		"SELECT user_id, task_id FROM weekly_assignments WHERE assigned_week = ? AND year = ? AND status = 'pending'",
		[global.nextWeek, global.year]
	);

	if (pendingTasks.length === 0) {
		console.log("✅ No pending tasks to remind.");
		return;
	}

	for (const task of pendingTasks) {
		const [userData] = await db.query(
			"SELECT name, phone_number FROM users WHERE id = ?",
			[task.user_id]
		);

		const [taskData] = await db.query(
			"SELECT task_name FROM tasks WHERE id = ?",
			[task.task_id]
		);

		if (userData.length > 0 && taskData.length > 0) {
			const user = userData[0];
			const taskName = taskData[0].task_name;

			const reminderMessage = `Hallo ${user.name}! 😊\nIch wollte dich erinnern, dass du noch nicht auf deine Aufgabe *${taskName}* geantwortet hast.\nKannst du es erledigen? Bitte antworte mit *ja* oder *nein*.`;

			await sendMessage(user.phone_number, reminderMessage, "contact");
			console.log(`🔔 Reminder sent to ${user.name} (${user.phone_number})`);
		}
	}
}

async function requestConfirmation() {
	const [pendingTasks] = await db.query(
		`SELECT 
			wa.task_id, 
			t.task_name AS taskName, 
			u.name AS userName, 
			u.phone_number AS phoneNumber 
		FROM weekly_assignments wa 
		JOIN users u ON wa.user_id = u.id 
		JOIN tasks t ON wa.task_id = t.id 
		WHERE wa.assigned_week = ? AND wa.year = ? AND wa.status = 'pending'`,
		[global.nextWeek, global.year]
	);

	for (const task of pendingTasks) {
		const message = `Hallo ${task.userName}! 😊\nDiese Woche bist du für die Aufgabe *${task.taskName}* zuständig.\nKannst du es erledigen? Bitte antworte mit *ja* oder *nein*.`;
		await sendMessage(task.phoneNumber, message, "contact");
		// console.log("Message sent to: " + task.userName + " for task: " + task.taskName + " on number: " + task.phoneNumber)
	}
}


async function waitForResponse(sock, phoneNumber) {
	return new Promise((resolve) => {
		const messageHandler = (msg) => {

			if (!msg || !msg.messages || msg.messages.length === 0) return;

			const messageData = msg.messages[0];
			if (!messageData.key || !messageData.key.remoteJid) return;

			const sender = messageData.key.remoteJid.replace(/[@].*/, "");

			if (messageData.key.fromMe) return;

			if (sender === phoneNumber) {
				sock.ev.off("messages.upsert", messageHandler);
				resolve(
					messageData.message?.conversation ||
					messageData.message?.extendedTextMessage?.text ||
					""
				);
			}
		};

		sock.ev.on("messages.upsert", messageHandler);
	});
}

async function handleUserResponse(sock, userId, message) {

	let phoneNumber = await getNumber(userId);

	console.log(phoneNumber, message);

	const [TaskNextWeek] = await db.query(
		"SELECT * FROM weekly_assignments WHERE user_id = ? AND assigned_week = ? AND year = ? AND status IN ('pending', 'confirmed')",
		[userId, global.nextWeek, global.year]
	);

	const [TaskThisWeek] = await db.query(
		"SELECT * FROM weekly_assignments WHERE user_id = ? AND assigned_week = ? AND year = ? AND status IN ('confirmed')",
		[userId, global.week, global.year]
	);

	if ((message.toLowerCase() === "ja" || message.toLowerCase() === "nein") && TaskNextWeek.length > 0) {
		if(message.toLowerCase() === "ja"){
			const task = TaskNextWeek[0];
			await db.query(
				"UPDATE weekly_assignments SET status = 'confirmed' WHERE id = ?",
				[task.id]
			);
			await checkIfAllConfirmed();
			await sendMessage(phoneNumber, "Super! Danke, dass du die Aufgabe übernimmst!", "contact");
			return;
		} else {
			await declineTask(task);
			await reassignTask(task);
			await sendMessage(phoneNumber, "Schade! Die Aufgabe wurde erneut zugewiesen. Vielen Dank für deine Rückmeldung!", "contact");
			return;
		}
	}

	if ((message.toLowerCase() === "erledigt" || message.toLowerCase() === "unerledigt") && TaskThisWeek.length > 0) {
		if (message.toLowerCase() === "erledigt") {
			await sendMessage(phoneNumber, "Vielen Dank, dein Punktzahl wurde aktualisiert.", "contact");
			await updatePoints(userId);
		} else {
			await sendMessage(phoneNumber, "Schade, ich hoffe, dass du die Aufgabe beim nächsten Mal schaffen.", "contact");
		}
		return;
	}

	if (message.toLowerCase() === "ja" || message.toLowerCase() === "nein" && TaskNextWeek.length === 0) {
		await sendMessage(phoneNumber, "Du hast entweder bereits eine Aufgabe bestätigt/abgelehnt oder du hast keine Aufgabe für nachste Woche.", "contact");
		return;
	}

	if (message.toLowerCase() === "erledigt" || message.toLowerCase() === "unerledigt" && TaskThisWeek.length === 0) {
		await sendMessage(phoneNumber, "Du hast keine Aufgabe diese Woche.", "contact");
		return;
	}

	if (message.toLowerCase() === "admin") {
		if (await checkIfParticipant(userId)) {
			await sendMessage(phoneNumber, "Du kannst die folgenden Befehle verwenden:\n\n- *report*: Um den Bericht zu sehen.\n- *change numbers*: Um die Nummer zu ändern.", "contact");
		}
		return;
	}

	if (message.toLowerCase() === "do assign tasks") {
		if (await checkIfAdmin(phoneNumber)) {
			await assignTasks();
			await sendMessage(phoneNumber, "Function called: assignTasks", "contact");
		}
		return;
	}

	if (message.toLowerCase() === "do task complete message") {
		if (await checkIfAdmin(phoneNumber)) {
			await taskCompleteMessage();
			await sendMessage(phoneNumber, "Function called: taskCompleteMessage", "contact");
		}
		return;
	}

	if (message.toLowerCase() == "do request confirmation") {
		if (await checkIfAdmin(phoneNumber)) {
			await requestConfirmation();
			await sendMessage(phoneNumber, "Function called: requestConfirmation", "contact");
		}
		return;
	}

	if (message.toLowerCase() == "do remind pending tasks") {
		if (await checkIfAdmin(phoneNumber)) {
			await remindPendingTasks();
			await sendMessage(phoneNumber, "Function called: remindPendingTasks", "contact");
		}
		return;
	}

	if (message.toLowerCase() == "do check and reassign pending tasks") {
		if (await checkIfAdmin(phoneNumber)) {
			await checkAndReassignPendingTasks();
			await sendMessage(phoneNumber, "Function called: checkAndReassignPendingTasks", "contact");
		}
		return;
	}

	if (message.toLowerCase() == "do message if pending") {
		if (await checkIfAdmin(phoneNumber)) {
			await messageIfPending();
			await sendMessage(phoneNumber, "Function called: messageIfPending", "contact");
		}
		return;
	}

	if (message.toLowerCase() == "do help") {
		if (await checkIfAdmin(phoneNumber)) {
			await sendMessage(phoneNumber, "Functions (do + :\nassign tasks: Assign weekly assignments\nrequest confirmation: Request first confirmation from participants\n remind pending tasks: Remind participants about their assignments\ncheck and reassign pending tasks: Reassign unconfirmed assignments to others\nmessage if pending: Send group message with weekly assignments", "contact");
		}
		return;
	}

	if (message.toLowerCase() === "report") {
		await sendCleaningScores(phoneNumber);
		return;
	} else if (message.toLowerCase() === "change numbers") {
		let phrase = await changeNumber(userId);
		await sendMessage(phoneNumber, phrase, "contact");
		userStates[userId] = { step: 0 };
		return;
	} else if (userStates[userId]) {
		let phoneNumber = await getNumber(userId);
		switch (userStates[userId].step) {
			case 0:
				userStates[userId].selectedUserId = await waitForResponse(sock, phoneNumber);
				userStates[userId].step = 1;
				break;
			case 1:
				await sendMessage(phoneNumber, "Bitte gib den neuen Namen ein:", "contact");
				userStates[userId].step = 2;
				break;
			case 2:
				userStates[userId].newName = await waitForResponse(sock, phoneNumber);
				userStates[userId].step = 3;
				break;
			case 3:
				await sendMessage(phoneNumber, "Bitte gib die neue Nummer ein:", "contact");
				userStates[userId].step = 4;
				break;
			case 4:
				userStates[userId].newNumber = await waitForResponse(sock, phoneNumber);
				userStates[userId].step = 5;
				break;
			case 5:
				await updateUserDetails(userStates[userId].selectedUserId, userStates[userId].newName, userStates[userId].newNumber);
				delete userStates[userId];
				await sendMessage(phoneNumber, "Deine Daten wurden erfolgreich aktualisiert.", "contact");
				break;
		}
	}
	return;
}

async function checkIfAllConfirmed() {
	const [tasks] = await db.query(
		"SELECT COUNT(*) AS total_tasks FROM tasks;"
	);

	const totalTasks = tasks[0].total_tasks;
	const [assignments] = await db.query(
		"SELECT COUNT(*) AS total FROM weekly_assignments WHERE assigned_week = ? AND year = ? AND status = 'confirmed';", [global.nextWeek, global.year]);

	const confirmedAssignments = assignments[0].total;
	if (confirmedAssignments == totalTasks) {
		createMessageGroupChat()
	}
}

async function messageIfPending(year, week) {
	const [tasks] = await db.query(
		"SELECT COUNT(*) AS total_tasks FROM tasks;"
	);

	const totalTasks = tasks[0].total_tasks;
	const [assignments] = await db.query(
		"SELECT COUNT(*) AS total FROM weekly_assignments WHERE assigned_week = ? AND year = ? AND status = 'confirmed';", [week, year]);

	const confirmedAssignments = assignments[0].total;
	if (confirmedAssignments != totalTasks) {
		createMessageGroupChat();
	}
}

async function createMessageGroupChat() {
	const [assignments] = await db.query(`
    SELECT wa.task_id, t.task_name, wa.status, u.name AS user_name FROM weekly_assignments wa JOIN users u ON wa.user_id = u.id JOIN tasks t ON wa.task_id = t.id WHERE wa.assigned_week = ? AND wa.year = ?;
  `, [global.nextWeek, global.year]);

	const tasksToReport = assignments.reduce((acc, task) => {
		if (!acc[task.task_id]) {
			acc[task.task_id] = {
				taskName: task.task_name,
				confirmedUsers: [],
				declinedUsers: [],
				pendingUsers: [],
			};
		}
		if (task.status === "confirmed") {
			acc[task.task_id].confirmedUsers.push(task.user_name);
		} else if (task.status === "declined") {
			acc[task.task_id].declinedUsers.push(task.user_name);
		} else if (task.status === "pending") {
			acc[task.task_id].pendingUsers.push(task.user_name);
		}
		return acc;
	}, {});

	let message = "❗Diese Woche's Putzplan:❗\n";

	Object.values(tasksToReport).forEach(task => {
		if (task.declinedUsers.length > 0 && task.confirmedUsers.length > 0) {
			message += `✦ Aufgabe: ${task.taskName} wurde ${task.confirmedUsers[0]} statt ${task.declinedUsers[0]} zugewiesen\n`;
		} else if (task.pendingUsers.length > 0 && task.confirmedUsers.length == 0) {
			message += `✦ Aufgabe: ${task.taskName} wartet auf die Bestätigung von ${task.pendingUsers[0]}.\n`;
		} else if (task.pendingUsers.length == 0 && task.confirmedUsers.length == 0) {
			message += `✦ Aufgabe: ${task.taskName} hat diese Woche keine verantwortliche Person.\n`;
		} else {
			message += `✦ Aufgabe: ${task.taskName} wurde an ${task.confirmedUsers[0]} zugewiesen\n`;
		}
	});

	message += "\n✨ Vielen Dank! ✨";

	const groupId = process.env.GROUP_ID;
	sendMessage(groupId, message, "group");
}

async function updateUserDetails(userId, newName, newNumber) {
	await db.query(
		"UPDATE users SET name = ?, phone_number = ? WHERE id = ?",
		[newName, newNumber, userId]
	);
}

async function checkIfParticipant(userId) {
	const [rows] = await db.query(
		"SELECT phone_number FROM users WHERE id = ?",
		[userId]
	);
	const phoneNumber = rows[0]?.phone_number || null;
	return phoneNumber ? true : false;
}


async function checkIfAdmin(phoneNumber) {
	return phoneNumber == process.env.ADMIN_NUMBER;
}


async function getNumber(userId) {
	const [rows] = await db.query(
		"SELECT phone_number FROM users WHERE id = ?",
		[userId]
	);
	const phoneNumber = rows[0]?.phone_number || null;
	return phoneNumber;
}

async function changeNumber(userId) {
	const [users] = await db.query("SELECT id, name FROM users");

	const [rows] = await db.query(
		"SELECT phone_number FROM users WHERE id = ?",
		[userId]
	);

	const phoneNumber = rows[0]?.phone_number || null;
	if (!phoneNumber) return;

	const userList = users.map(user => `${user.id}. ${user.name}`).join("\n");

	userStates[userId] = { step: 0 };

	return `Welche Number möchten Sie ändern? Bitte geben Sie die Ziffer ein:\n\n${userList}`;

}

async function declineTask(task) {
	await db.query(
		"UPDATE weekly_assignments SET status = 'declined' WHERE id = ? AND assigned_week = ? AND year = ? AND status = 'pending'",
		[task.id, global.nextWeek, global.year]
	);
}

async function reassignTask(task) {

	const { assignments, users } = await getTaskAssignments();

	const [declinedUsers] = await db.query(
		`SELECT user_id FROM weekly_assignments 
     WHERE assigned_week = ? AND year = ? AND (status = 'declined' OR status = 'confirmed')`,
		[global.nextWeek, global.year]
	);

	const declinedUserId = declinedUsers.map(user => Number(user.user_id));

	const eligibleUsers = assignments
		.filter(a => Number(a.task_id) === Number(task.task_id))
		.map(a => users.find(u => u.id === a.user_id))
		.filter(Boolean)
		.filter(user => !declinedUserId.includes(user.id));

	for (const user of eligibleUsers) {
		const [existingConfirmation] = await db.query(
			"SELECT * FROM weekly_assignments WHERE user_id = ? AND assigned_week = ? AND year = ?",
			[user.id, global.nextWeek, global.year]
		);

		if (existingConfirmation.length === 0) {
			const message = `Hallo ${user.name}! 😊 \nDie Aufgabe *${task.task_name}* wurde neu zugewiesen. Kannst du sie übernehmen? Antworte mit *ja* oder *nein*.`;
			await sendMessage(user.phone_number, message, "contact");
			await savePendingTask(user.id, task.task_id, global.nextWeek, global.year);
			return;
		}
	}
	console.log(`❌ Keine verantwortliche Person gefunden für die Aufgabe: ${task.task_name}`);
}

async function savePendingTask(userId, taskId) {
	await db.query(
		"INSERT INTO weekly_assignments (user_id, task_id, assigned_week, year, status) VALUES (?, ?, ?, ?, 'pending')",
		[userId, taskId, global.nextWeek, global.year]
	);
}

async function getTaskAssignments() {


	const [tasks] = await db.query('SELECT id, task_name, points FROM tasks');
	const [assignments] = await db.query('SELECT task_id, user_id FROM task_assignments');
	const [users] = await db.query('SELECT id, name, phone_number FROM users');
	const [cleaningScores] = await db.query('SELECT user_id, kitchen_cleaning, bathroom_cleaning, other_cleaning FROM cleaning_scores');
	const [taskCategories] = await db.query('SELECT task_id, category_id FROM task_cleaning_scores');
	const [weeklyAssignments] = await db.query("SELECT * FROM wpp.weekly_assignments WHERE assigned_week = ? AND year = ?", [global.nextWeek, global.year]);

	return {
		tasks,
		assignments,
		users,
		cleaningScores,
		taskCategories,
		weeklyAssignments
	};
}
async function sendCleaningScores(phoneNumber) {
	try {
		const { users, cleaningScores } = await getTaskAssignments();

		let message = `🏠 Reinigungs - Punktestand 🏠`;
		users.forEach(user => {
			const userScore = cleaningScores.find(score => score.user_id === user.id) || {};
			message += `\n\n${user.name}:\n`;
			message += `Küche: ${userScore.kitchen_cleaning || 0} Pkt.\nBad: ${userScore.bathroom_cleaning || 0} Pkt.\nSonst.: ${userScore.other_cleaning || 0} Pkt.`;
		});

		sendMessage(phoneNumber, message, "contact");
	} catch (error) {
		console.error("Error fetching cleaning scores:", error);
	}
}
async function assignTasks() {
	const { tasks, assignments, users, cleaningScores, taskCategories } = await getTaskAssignments();

	const userCategoryPoints = users.map(user => ({
		userId: user.id,
		userName: user.name,
		kitchen: cleaningScores.find(score => score.user_id === user.id)?.kitchen_cleaning || 0,
		bathroom: cleaningScores.find(score => score.user_id === user.id)?.bathroom_cleaning || 0,
		other: cleaningScores.find(score => score.user_id === user.id)?.other_cleaning || 0,
	}));

	let taskAssignments = [];
	let assignedUsers = new Set();

	tasks.forEach(task => {
		const category = taskCategories.find(tc => tc.task_id === task.id);
		const categoryName = category ? getCategoryName(category.category_id) : "other";

		const eligibleUsers = assignments
			.filter(a => a.task_id === task.id)
			.map(a => userCategoryPoints.find(user => user.userId === a.user_id))
			.filter(Boolean);

		const sortedUsers = eligibleUsers.length > 1 ?
			eligibleUsers.sort((a, b) => a[categoryName] - b[categoryName]) :
			eligibleUsers.sort(() => Math.random() - 0.5);

		let assignedUser = sortedUsers.find(user => !assignedUsers.has(user.userId));

		if (!assignedUser) {
			assignedUser = sortedUsers[0];
		}

		assignedUsers.add(assignedUser.userId);

		taskAssignments.push({
			taskName: task.task_name,
			userName: assignedUser.userName,
			userId: assignedUser.userId,
			taskId: task.id,
			taskPoints: task.points,
			category: categoryName
		});
	});

	let reassignedTasks = [];
	let userTaskCount = {};

	taskAssignments.forEach(task => {
		userTaskCount[task.userId] = (userTaskCount[task.userId] || 0) + 1;
	});

	Object.keys(userTaskCount).forEach(userId => {
		if (userTaskCount[userId] > 1) {
			let userTasks = taskAssignments.filter(t => t.userId == userId);
			userTasks.sort((a, b) => b.taskPoints - a.taskPoints);
			let tasksToReassign = userTasks.slice(1);

			tasksToReassign.forEach(task => {
				let availableUsers = userCategoryPoints.filter(user =>
					!taskAssignments.some(t => t.userId === user.userId) && user.userId !== userId
				);

				let newUser = availableUsers.length > 0 ? availableUsers[0] : null;

				if (newUser) {
					reassignedTasks.push({ ...task, newUser });
				}
			});

			taskAssignments = taskAssignments.filter(t => !tasksToReassign.includes(t));
		}
	});

	for (const task of [...taskAssignments, ...reassignedTasks]) {
		await db.query(
			"INSERT INTO weekly_assignments (user_id, task_id, assigned_week, year, status) VALUES (?, ?, ?, ?, ?)",
			[
				task.userId || task.newUser.userId,
				task.taskId,
				global.nextWeek,
				global.year,
				"pending"
			]
		);
	}
	console.log("✅ Tasks assigned and saved to database.");
}
function getCategoryName(categoryId) {
	switch (categoryId) {
		case 1:
			return "kitchen";
		case 2:
			return "bathroom";
		case 3:
			return "other";
		default:
			return "other";
	}
}
async function updatePoints(userId) {


	const [rows] = await db.query(
		"SELECT task_id FROM weekly_assignments WHERE user_id = ? AND year = ? AND assigned_week = ?",
		[userId, year, week]
	);

	const task_id = rows[0]?.task_id || null;

	if (!task_id) {
		console.log(`No task assigned for user ${userId} in week ${global.nextWeek} of year ${global.year}`);
		return;
	}

	await db.query(
		`
      UPDATE cleaning_scores cs
      JOIN task_cleaning_scores tcs ON tcs.task_id = ? AND cs.user_id = ?
      JOIN tasks t ON t.id = ?
      JOIN categories c ON c.id = tcs.category_id
      SET 
        cs.kitchen_cleaning = CASE WHEN c.category_name = 'kitchen_cleaning' THEN cs.kitchen_cleaning + t.points ELSE cs.kitchen_cleaning END,
        cs.bathroom_cleaning = CASE WHEN c.category_name = 'bathroom_cleaning' THEN cs.bathroom_cleaning + t.points ELSE cs.bathroom_cleaning END,
        cs.other_cleaning = CASE WHEN c.category_name = 'other_cleaning' THEN cs.other_cleaning + t.points ELSE cs.other_cleaning END
      WHERE cs.user_id = ?
    `,
		[task_id, userId, task_id, userId]
	);

	console.log(`Points updated for user ${userId} in task ${task_id}`);

	await db. query(`UPDATE weekly_assignments SET status = "completed" WHERE user_id = ? AND assigned_week = ? AND year = ?
	`,[userId, global.week, global.year ])
}

const sendMessage = async (number, message, type) => {
	if (!number || !message || !type) {
		console.log("number, message, and type are required");
		return;
	}

	if (sock) {
		if (type === "group") {
			try {
				const id = number + "@g.us";
				await sock.sendMessage(id, { text: message });
				console.log("Message sent successfully to the groupchat");
			} catch (error) {
				console.error("Error sending message: ", error);
			}
		} else if (type === "contact") {
			try {
				const id = number + "@s.whatsapp.net";
				await sock.sendMessage(id, { text: message });
				console.log("Message sent successfully to the contact: " + number);
			} catch (error) {
				console.error("Error sending message: ", error);
			}
		} else {
			console.log('Invalid type. Use "group" or "contact"');
		}
	} else {
		console.log("Socket not initialized, message not sent");
	}
};

await connectToWhatsApp();

controlPanel().catch(err => console.log(err));