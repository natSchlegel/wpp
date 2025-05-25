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
ADMIN_NUMBER=your_whatsapp_admin_number
GROUP_ID=your_group_id
```

3. Set Up the Database

This project uses a SQLite database, managed by Prisma. Here's how to initialize your database schema with Prisma and then populate it with your existing data.
3.1. Install SQLite Command-Line Tool

First, make sure you have the sqlite3 command-line tool installed on your system. You'll need this to import your data.

    For Debian/Ubuntu:

    sudo apt-get update
    sudo apt-get install sqlite3


    For macOS (using Homebrew):

    brew install sqlite


    For Windows:
    Download the precompiled binaries from the SQLite website and add the directory containing sqlite3.exe to your system's PATH environment variable.

3.2. Prepare Prisma for Migration

Now, let's get Prisma ready to create your database schema.

    Remove any old Prisma migrations (if they exist):
    It's crucial to start fresh to avoid conflicts with previous migration attempts.

    rm -rf prisma/migrations


    Generate your Prisma schema and apply migrations:
    This command will create your dev.db SQLite file (if it doesn't exist) and build all tables based on your prisma/schema.prisma file.

    npx prisma migrate dev --name initial_schema_setup


    You'll be prompted to provide a name for this migration (e.g., initial_schema_setup). Prisma will then generate the necessary SQL and apply it to your dev.db.

3.3. Import Initial Data

With your database schema now set up by Prisma, you can import your existing data.

    Ensure your data dump is ready:
    Make sure your database-dump.sql file (which should only contain INSERT statements, and be adapted for SQLite) is in your project's root directory.

    Import the data into your database:
    This command will execute the INSERT statements from your database-dump.sql file into the prisma/dev.db database that Prisma just created.

    sqlite3 prisma/dev.db < database-dump.sql


3.4. Verify (Optional)

To confirm your database is set up correctly and contains your data, open Prisma Studio:

npx prisma studio


This will launch a browser window showing your database tables and their contents. You should see the data you just imported.

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
- **Sunday (8 AM)**: Schedule messages are sent to the house's group chat.

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
