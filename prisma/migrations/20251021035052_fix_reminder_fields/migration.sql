/*
  Warnings:

  - The values [STARTER] on the enum `Subscription_plan` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `subscription` ADD COLUMN `reminderDay1Send` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reminderDay4Send` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reminderDay7Send` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `plan` ENUM('BASIC', 'STANDARD', 'PREMIUM') NOT NULL;
