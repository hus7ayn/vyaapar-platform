-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "party_id" TEXT;

-- CreateIndex
CREATE INDEX "guests_party_id_idx" ON "guests"("party_id");

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
