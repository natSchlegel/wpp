-- CreateTable
CREATE TABLE "categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category_name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "cleaning_scores" (
    "user_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kitchen_cleaning" INTEGER NOT NULL,
    "bathroom_cleaning" INTEGER NOT NULL,
    "other_cleaning" INTEGER NOT NULL,
    CONSTRAINT "cleaning_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "task_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    PRIMARY KEY ("task_id", "user_id"),
    CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_cleaning_scores" (
    "task_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    PRIMARY KEY ("task_id", "category_id"),
    CONSTRAINT "task_cleaning_scores_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_cleaning_scores_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "task_name" TEXT NOT NULL,
    "points" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "phone_number" TEXT
);

-- CreateTable
CREATE TABLE "weekly_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "assigned_week" INTEGER NOT NULL,
    "status" TEXT DEFAULT 'pending',
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "modified_at" DATETIME,
    "year" INTEGER,
    CONSTRAINT "weekly_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "weekly_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
