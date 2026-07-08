-- AlterTable
ALTER TABLE "folio_charges" ADD COLUMN     "item_id" TEXT,
ADD COLUMN     "quantity" DECIMAL(14,3);

-- CreateIndex
CREATE INDEX "folio_charges_item_id_idx" ON "folio_charges"("item_id");

-- AddForeignKey
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
