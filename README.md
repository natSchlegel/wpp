# Task Management and WhatsApp Integration

This project automates weekly task management and reminders via WhatsApp. The application connects to WhatsApp using the Baileys library, interacts with a MySQL database for task assignment, and sends notifications and reminders to users for task confirmations and reassignments.

## Features
- **Weekly Task Assignment**: Assign tasks to users every Monday at 8 AM.
- **Task Confirmation Requests**: Send a request to confirm task completion on Wednesdays at 10 AM.
- **Pending Task Reminders**: Remind users of pending tasks on Fridays at 10 AM.
- **Pending Task Reassignments**: Automatically reassign pending tasks on Saturdays.
- **User Interaction via WhatsApp**: Allows users to respond to task assignments and updates via WhatsApp.
- **Task Status Updates**: Confirm, decline, or reassign tasks based on user responses.
- **Admin Commands**: Admins can request task reports or update user details directly through WhatsApp.

## Setup

### 1. Install Dependencies

```bash
npm install mysql2 baileys qrcode-terminal moment node-cron dotenv
```

### 2. Configure Environment Variables

Create a `.env` file in the root of your project with the following variables:

```env
DB_HOST=your_database_host
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=your_database_name
ADMIN_NUMBER=your_whatsapp_admin_number
```

### 3. Set Up the Database

To set up the database for this project, you need to use the provided database-dump.sql file, which contains the necessary structure and initial data for the application.
Steps to set up the database:

1. Create a new MySQL database or use an existing one.
2. Import the database-dump.sql file into your database.
 - You can do this by running the following command from the MySQL command line:
```bash
mysql -u <username> -p <database_name> < path_to/database-dump.sql
```
 - Replace ```bash<username>``` with your MySQL username, ```bas<database_name>``` with the name of the database you're using, and path_to/database-dump.sql with the path to the database-dump.sql file.

### 4. Run the Application

Once dependencies are installed and the database is set up, run the application:

```bash
node index.js
```

The application will start, and the control panel will begin scheduling tasks, sending reminders, and processing user responses.

## How It Works

The application follows a **cron-based scheduling system** to manage weekly tasks and user notifications:
- **Monday (8 AM)**: Tasks are assigned to users for the week.
- **Wednesday (10 AM)**: Task confirmation requests are sent to users.
- **Friday (10 AM)**: Reminders are sent to users for pending tasks.
- **Saturday (8 AM)**: Pending tasks are reassigned to other users if needed.
- **Sunday (8 AM)**: Pending task messages are sent again to remind users.

### WhatsApp Integration

The application connects to WhatsApp using the **Baileys library** for message handling and user interaction. It uses **multi-file authentication** to store session credentials. When the connection is successfully established, it listens for incoming messages, handles responses, and updates the task assignments accordingly.

### Admin Commands

Admins can interact with the bot using predefined commands:
- **report**: Request the current task report.
- **change numbers**: Update user information (name and phone number).

## Contributing

Feel free to fork the repository, make improvements, or suggest new features! For larger contributions, please open an issue first.

## License

This project is licensed under the MIT License.
