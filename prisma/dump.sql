-- SQL Dump for SQLite (adapted from MySQL)

-- Disable foreign key checks for a smoother import, re-enable at the end.
PRAGMA foreign_keys = OFF;

INSERT INTO `categories` VALUES (1,'kitchen_cleaning','Tasks related to cleaning the kitchen');
INSERT INTO `categories` VALUES (2,'bathroom_cleaning','Tasks related to cleaning the bathroom');
INSERT INTO `categories` VALUES (3,'other_cleaning','Other types of cleaning tasks');

INSERT INTO `cleaning_scores` VALUES (1,0,2,0);
INSERT INTO `cleaning_scores` VALUES (2,0,0,0);
INSERT INTO `cleaning_scores` VALUES (3,0,0,0);
INSERT INTO `cleaning_scores` VALUES (4,0,0,0);
INSERT INTO `cleaning_scores` VALUES (5,0,0,0);
INSERT INTO `cleaning_scores` VALUES (6,0,0,0);

INSERT INTO `task_assignments` VALUES (2,1);
INSERT INTO `task_assignments` VALUES (3,1);
INSERT INTO `task_assignments` VALUES (4,1);
INSERT INTO `task_assignments` VALUES (2,2);
INSERT INTO `task_assignments` VALUES (3,2);
INSERT INTO `task_assignments` VALUES (4,2);
INSERT INTO `task_assignments` VALUES (2,3);
INSERT INTO `task_assignments` VALUES (3,3);
INSERT INTO `task_assignments` VALUES (4,3);
INSERT INTO `task_assignments` VALUES (1,4);
INSERT INTO `task_assignments` VALUES (3,4);
INSERT INTO `task_assignments` VALUES (4,4);
INSERT INTO `task_assignments` VALUES (1,5);
INSERT INTO `task_assignments` VALUES (3,5);
INSERT INTO `task_assignments` VALUES (4,5);
INSERT INTO `task_assignments` VALUES (1,6);
INSERT INTO `task_assignments` VALUES (3,6);
INSERT INTO `task_assignments` VALUES (4,6);

INSERT INTO `task_cleaning_scores` VALUES (3,1);
INSERT INTO `task_cleaning_scores` VALUES (1,2);
INSERT INTO `task_cleaning_scores` VALUES (2,2);
INSERT INTO `task_cleaning_scores` VALUES (4,3);

INSERT INTO `tasks` VALUES (1,'Bad putzen (oben)',2);
INSERT INTO `tasks` VALUES (2,'Bad putzen (unten)',2);
INSERT INTO `tasks` VALUES (3,'Küche putzen',4);
INSERT INTO `tasks` VALUES (4,'2. Stock und Treppe staubsaugen',1);

INSERT INTO `users` VALUES (1,'First Name','0');
INSERT INTO `users` VALUES (2,'Second Name','0');
INSERT INTO `users` VALUES (3,'Third Name','0');
INSERT INTO `users` VALUES (4,'Fourth Name','0');
INSERT INTO `users` VALUES (5,'Fifth Name','0');
INSERT INTO `users` VALUES (6,'Sixth Name','0');
