import { PrismaClient } from "@prisma/client";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys";
import qrcode from "qrcode-terminal";
import moment from "moment";
import cron from "node-cron";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
let sock;
const userStates = {};

global.week = moment().isoWeek();
global.nextWeek = moment().add(1, 'week').isoWeek();
global.year = moment().isoWeekYear();

const controlPanel = async () => {
    console.log("Control Panel is running...");

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
                },
                patchMessageBeforeSending: (message, jids) => jids ? jids.map(jid => ({ recipientJid: jid, ...message })) : message
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

                const user = await prisma.user.findFirst({
                    where: {
                        phone_number: phoneNumber
                    }
                });

                if (!user) {
                    // sendMessage(process.env.ADMIN_NUMBER, text, "contact")
                } else {
                    await handleUserResponse(sock, user.id, text);
                }
            });

        } catch (error) {
            console.error("Error in connectToWhatsApp:", error);
            reject(error);
        }
    });
}

async function checkAndReassignPendingTasks() {
    const pendingTasks = await prisma.weeklyAssignment.findMany({
        where: {
            status: 'pending',
            assigned_week: global.nextWeek,
            year: global.year
        },
        include: {
            task: true
        }
    });

    if (pendingTasks.length === 0) {
        console.log("✅ No pending tasks found.");
        return;
    }

    for (const task of pendingTasks) {
        console.log(`🔄 Declining task ${task.task_id}...`);
        await declineTask(task);
    }

    for (const task of pendingTasks) {
        console.log(`🔄 Reassigning task ${task.task_id}...`);
        await reassignTask(task);
    }
}

async function taskCompleteMessage() {
    const confirmedTasks = await prisma.weeklyAssignment.findMany({
        where: {
            assigned_week: global.week,
            year: global.year,
            status: 'confirmed'
        },
        include: {
            user: {
                select: {
                    name: true,
                    phone_number: true
                }
            },
            task: {
                select: {
                    task_name: true
                }
            }
        }
    });

    for (const task of confirmedTasks) {
        const message = `Hallo ${task.user.name}! 😊\nDiese Woche warst du für die Aufgabe *${task.task.task_name}* zuständig.\nHast du sie erledigt? Bitte antworte mit *erledigt* oder *unerledigt*.`;
        await sendMessage(task.user.phone_number, message, "contact");
    }
}

async function remindPendingTasks() {
    const pendingTasks = await prisma.weeklyAssignment.findMany({
        where: {
            assigned_week: global.nextWeek,
            year: global.year,
            status: 'pending'
        },
        include: {
            user: {
                select: {
                    name: true,
                    phone_number: true
                }
            },
            task: {
                select: {
                    task_name: true
                }
            }
        }
    });

    if (pendingTasks.length === 0) {
        console.log("✅ No pending tasks to remind.");
        return;
    }

    for (const task of pendingTasks) {
        const reminderMessage = `Hallo ${task.user.name}! 😊\nIch wollte dich erinnern, dass du noch nicht auf deine Aufgabe *${task.task.task_name}* geantwortet hast.\nKannst du es erledigen? Bitte antworte mit *ja* oder *nein*.`;
        await sendMessage(task.user.phone_number, reminderMessage, "contact");
        console.log(`🔔 Reminder sent to ${task.user.name} (${task.user.phone_number})`);
    }
}

async function requestConfirmation() {
    const pendingTasks = await prisma.weeklyAssignment.findMany({
        where: {
            assigned_week: global.nextWeek,
            year: global.year,
            status: 'pending'
        },
        include: {
            user: {
                select: {
                    name: true,
                    phone_number: true
                }
            },
            task: {
                select: {
                    task_name: true
                }
            }
        }
    });

    for (const task of pendingTasks) {
        const message = `Hallo ${task.user.name}! 😊\nDiese Woche bist du für die Aufgabe *${task.task.task_name}* zuständig.\nKannst du es erledigen? Bitte antworte mit *ja* oder *nein*.`;
        await sendMessage(task.user.phone_number, message, "contact");
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

    const taskNextWeek = await prisma.weeklyAssignment.findFirst({
        where: {
            user_id: userId,
            assigned_week: global.nextWeek,
            year: global.year,
            status: {
                in: ['pending', 'confirmed']
            }
        }
    });

    const taskThisWeek = await prisma.weeklyAssignment.findFirst({
        where: {
            user_id: userId,
            assigned_week: global.week,
            year: global.year,
            status: {
                in: ['confirmed']
            }
        }
    });

    if (typeof message === "string") {
        if ((message.toLowerCase() === "ja" || message.toLowerCase() === "nein") && taskNextWeek) {
            if (message.toLowerCase() === "ja") {
                await prisma.weeklyAssignment.update({
                    where: {
                        id: taskNextWeek.id
                    },
                    data: {
                        status: 'confirmed'
                    }
                });
                await checkIfAllConfirmed();
                await sendMessage(phoneNumber, "Super! Danke, dass du die Aufgabe übernimmst!", "contact");
                return;
            } else {
                await declineTask(taskNextWeek);
                await reassignTask(taskNextWeek);
                await sendMessage(phoneNumber, "Schade! Die Aufgabe wurde erneut zugewiesen. Vielen Dank für deine Rückmeldung!", "contact");
                return;
            }
        }

        if ((message.toLowerCase() === "erledigt" || message.toLowerCase() === "unerledigt") && taskThisWeek) {
            if (message.toLowerCase() === "erledigt") {
                await sendMessage(phoneNumber, "Vielen Dank, dein Punktzahl wurde aktualisiert.", "contact");
                await updatePoints(userId);
            } else {
                await sendMessage(phoneNumber, "Schade, ich hoffe, dass du die Aufgabe beim nächsten Mal schaffen.", "contact");
            }
            return;
        }

        if ((message.toLowerCase() === "ja" || message.toLowerCase() === "nein") && !taskNextWeek) {
            await sendMessage(phoneNumber, "Du hast entweder bereits eine Aufgabe bestätigt/abgelehnt oder du hast keine Aufgabe für nächste Woche.", "contact");
            return;
        }

        if ((message.toLowerCase() === "erledigt" || message.toLowerCase() === "unerledigt") && !taskThisWeek) {
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
                await messageIfPending(global.nextWeek, global.year);
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
            let currentPhoneNumber = await getNumber(userId);
            switch (userStates[userId].step) {
                case 0:
                    userStates[userId].selectedUserId = await waitForResponse(sock, currentPhoneNumber);
                    userStates[userId].step = 1;
                    break;
                case 1:
                    await sendMessage(currentPhoneNumber, "Bitte gib den neuen Namen ein:", "contact");
                    userStates[userId].step = 2;
                    break;
                case 2:
                    userStates[userId].newName = await waitForResponse(sock, currentPhoneNumber);
                    userStates[userId].step = 3;
                    break;
                case 3:
                    await sendMessage(currentPhoneNumber, "Bitte gib die neue Nummer ein:", "contact");
                    userStates[userId].step = 4;
                    break;
                case 4:
                    userStates[userId].newNumber = await waitForResponse(sock, currentPhoneNumber);
                    userStates[userId].step = 5;
                    break;
                case 5:
                    await updateUserDetails(parseInt(userStates[userId].selectedUserId), userStates[userId].newName, userStates[userId].newNumber);
                    delete userStates[userId];
                    await sendMessage(currentPhoneNumber, "Deine Daten wurden erfolgreich aktualisiert.", "contact");
                    break;
            }
        }
    }
}

async function checkIfAllConfirmed() {
    const totalTasks = await prisma.task.count();
    const confirmedAssignments = await prisma.weeklyAssignment.count({
        where: {
            assigned_week: global.nextWeek,
            year: global.year,
            status: 'confirmed'
        }
    });

    if (confirmedAssignments === totalTasks) {
        createMessageGroupChat();
    }
}

async function messageIfPending(week, year) {
    const totalTasks = await prisma.task.count();
    const confirmedAssignments = await prisma.weeklyAssignment.count({
        where: {
            assigned_week: week,
            year: year,
            status: 'confirmed'
        }
    });

    if (confirmedAssignments !== totalTasks) {
        createMessageGroupChat();
    }
}

async function createMessageGroupChat() {
    const assignments = await prisma.weeklyAssignment.findMany({
        where: {
            assigned_week: global.nextWeek,
            year: global.year
        },
        include: {
            user: {
                select: {
                    name: true
                }
            },
            task: {
                select: {
                    task_name: true
                }
            }
        }
    });

    const tasksToReport = assignments.reduce((acc, assignment) => {
        if (!acc[assignment.task_id]) {
            acc[assignment.task_id] = {
                taskName: assignment.task.task_name,
                confirmedUsers: [],
                declinedUsers: [],
                pendingUsers: [],
            };
        }
        if (assignment.status === "confirmed") {
            acc[assignment.task_id].confirmedUsers.push(assignment.user.name);
        } else if (assignment.status === "declined") {
            acc[assignment.task_id].declinedUsers.push(assignment.user.name);
        } else if (assignment.status === "pending") {
            acc[assignment.task_id].pendingUsers.push(assignment.user.name);
        }
        return acc;
    }, {});

    let message = `❗Diese Woche's (${getWeekRange()}) Putzplan:❗\n`;

    Object.values(tasksToReport).forEach(task => {
        if (task.declinedUsers.length > 0 && task.confirmedUsers.length > 0) {
            message += `✦ Aufgabe: ${task.taskName} wurde ${task.confirmedUsers[0]} statt ${task.declinedUsers[0]} zugewiesen\n`;
        } else if (task.pendingUsers.length > 0 && task.confirmedUsers.length === 0) {
            message += `✦ Aufgabe: ${task.taskName} wartet auf die Bestätigung von ${task.pendingUsers[0]}.\n`;
        } else if (task.pendingUsers.length === 0 && task.confirmedUsers.length === 0) {
            message += `✦ Aufgabe: ${task.taskName} hat diese Woche keine verantwortliche Person.\n`;
        } else {
            message += `✦ Aufgabe: ${task.taskName} wurde an ${task.confirmedUsers[0]} zugewiesen\n`;
        }
    });

    message += "\n✨ Vielen Dank! ✨";
    const groupId = process.env.GROUP_ID;
    sendMessage(groupId, message, "group");
}

function getWeekRange() {
    const startOfWeek = moment().year(global.year).week(global.nextWeek).startOf('isoWeek');
    const endOfWeek = moment(startOfWeek).endOf('isoWeek');
    const formatDate = (date) => date.format('DD.MM');

    return `${formatDate(startOfWeek)} ~ ${formatDate(endOfWeek)}`;
}

async function updateUserDetails(userId, newName, newNumber) {
    await prisma.user.update({
        where: {
            id: userId
        },
        data: {
            name: newName,
            phone_number: newNumber
        }
    });
}

async function checkIfParticipant(userId) {
    const user = await prisma.user.findUnique({
        where: {
            id: userId
        },
        select: {
            phone_number: true
        }
    });
    return user?.phone_number ? true : false;
}

async function checkIfAdmin(phoneNumber) {
    return phoneNumber === process.env.ADMIN_NUMBER;
}

async function getNumber(userId) {
    const user = await prisma.user.findUnique({
        where: {
            id: userId
        },
        select: {
            phone_number: true
        }
    });
    return user?.phone_number || null;
}

async function changeNumber(userId) {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            name: true
        }
    });

    const currentUser = await prisma.user.findUnique({
        where: {
            id: userId
        },
        select: {
            phone_number: true
        }
    });

    const phoneNumber = currentUser?.phone_number || null;
    if (!phoneNumber) return;

    const userList = users.map(user => `${user.id}. ${user.name}`).join("\n");

    userStates[userId] = { step: 0 };

    return `Welche Number möchten Sie ändern? Bitte geben Sie die Ziffer ein:\n\n${userList}`;
}

async function declineTask(task) {
    await prisma.weeklyAssignment.updateMany({
        where: {
            id: task.id,
            assigned_week: global.nextWeek,
            year: global.year,
            status: 'pending'
        },
        data: {
            status: 'declined'
        }
    });
}

async function reassignTask(task) {
    const { assignments, users } = await getTaskAssignments();

    const declinedUsers = await prisma.weeklyAssignment.findMany({
        where: {
            assigned_week: global.nextWeek,
            year: global.year,
            status: {
                in: ['declined', 'confirmed']
            }
        },
        select: {
            user_id: true
        }
    });

    const declinedUserIds = new Set(declinedUsers.map(user => user.user_id));

    const eligibleUsers = assignments
        .filter(a => a.task_id === task.task_id)
        .map(a => users.find(u => u.id === a.user_id))
        .filter(Boolean)
        .filter(user => !declinedUserIds.has(user.id));

    for (const user of eligibleUsers) {
        const existingConfirmation = await prisma.weeklyAssignment.findFirst({
            where: {
                user_id: user.id,
                assigned_week: global.nextWeek,
                year: global.year
            }
        });

        if (!existingConfirmation) {
            const message = `Hallo ${user.name}! 😊 \nDie Aufgabe *${task.task.task_name}* wurde neu zugewiesen. Kannst du sie übernehmen? Antworte mit *ja* oder *nein*.`;
            await sendMessage(user.phone_number, message, "contact");
            await savePendingTask(user.id, task.task_id);
            return;
        }
    }
    console.log(`❌ Keine verantwortliche Person gefunden für die Aufgabe: ${task.task.task_name}`);
}

async function savePendingTask(userId, taskId) {
    await prisma.weeklyAssignment.create({
        data: {
            user_id: userId,
            task_id: taskId,
            assigned_week: global.nextWeek,
            year: global.year,
            status: 'pending'
        }
    });
}

async function getTaskAssignments() {
    const tasks = await prisma.task.findMany();
    const assignments = await prisma.taskAssignment.findMany();
    const users = await prisma.user.findMany();
    const cleaningScores = await prisma.cleaningScore.findMany();
    const taskCategories = await prisma.taskCleaningScore.findMany();
    const weeklyAssignments = await prisma.weeklyAssignment.findMany({
        where: {
            assigned_week: global.nextWeek,
            year: global.year
        }
    });

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

        const now = moment();

        let message = `🏠 Reinigungs-Punktestand - ${now.format('DD.MM.YYYY HH:mm')} 🏠`;
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
                    !taskAssignments.some(t => t.userId === user.userId) && user.userId !== parseInt(userId)
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
        await prisma.weeklyAssignment.create({
            data: {
                user_id: task.userId || task.newUser.userId,
                task_id: task.taskId,
                assigned_week: global.nextWeek,
                year: global.year,
                status: 'pending'
            }
        });
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
    const weeklyAssignment = await prisma.weeklyAssignment.findFirst({
        where: {
            user_id: userId,
            year: global.year,
            assigned_week: global.week
        },
        select: {
            task_id: true
        }
    });

    const taskId = weeklyAssignment?.task_id || null;

    if (!taskId) {
        console.log(`No task assigned for user ${userId} in week ${global.week} of year ${global.year}`);
        return;
    }

    const taskCategory = await prisma.taskCleaningScore.findFirst({
        where: {
            task_id: taskId
        },
        select: {
            category_id: true
        }
    });

    const category = await prisma.category.findUnique({
        where: {
            id: taskCategory.category_id
        },
        select: {
            category_name: true
        }
    });

    const task = await prisma.task.findUnique({
        where: {
            id: taskId
        },
        select: {
            points: true
        }
    });

    if (category && task) {
        const categoryName = category.category_name.split('_')[0]; // "kitchen_cleaning" -> "kitchen"
        const pointsToAdd = task.points;

        const updateData = {};
        if (categoryName === 'kitchen') {
            updateData.kitchen_cleaning = { increment: pointsToAdd };
        } else if (categoryName === 'bathroom') {
            updateData.bathroom_cleaning = { increment: pointsToAdd };
        } else if (categoryName === 'other') {
            updateData.other_cleaning = { increment: pointsToAdd };
        }

        await prisma.cleaningScore.update({
            where: {
                user_id: userId
            },
            data: updateData
        });
        console.log(`Points updated for user ${userId} in task ${taskId}`);
    }

    await prisma.weeklyAssignment.updateMany({
        where: {
            user_id: userId,
            assigned_week: global.week,
            year: global.year
        },
        data: {
            status: "completed"
        }
    });
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
                if (error.message.includes('closed session')) {
                    await sock.ev.process({ type: 'session', action: 'delete', id });
                    await sock.sendMessage(id, { text: 'We had to reset our secure session. All good now!' });
                }
            }
        } else if (type === "contact") {
            try {
                const id = number + "@s.whatsapp.net";
                await sock.sendMessage(id, { text: message });
                console.log("Message sent successfully to the contact: " + number);
            } catch (error) {
                console.log(error);

                if (error.message.includes('closed session')) {
                    await sock.ev.process({ type: 'session', action: 'delete', id });
                    await sock.sendMessage(id, { text: 'We had to reset our secure session. All good now!' });
                }
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