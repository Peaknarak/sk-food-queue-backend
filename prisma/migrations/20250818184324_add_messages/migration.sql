-- DropIndex
DROP INDEX "User_type_idx";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QueueCounter" (
    "vendorId" TEXT NOT NULL PRIMARY KEY,
    "current" INTEGER NOT NULL,
    CONSTRAINT "QueueCounter_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_QueueCounter" ("current", "vendorId") SELECT "current", "vendorId" FROM "QueueCounter";
DROP TABLE "QueueCounter";
ALTER TABLE "new_QueueCounter" RENAME TO "QueueCounter";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Message_orderId_ts_idx" ON "Message"("orderId", "ts");
