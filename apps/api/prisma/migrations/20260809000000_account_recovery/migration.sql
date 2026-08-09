-- Account recovery: an emailed one-time code bound to a single account replaces the shared
-- per-role reset key. See docs/plans/account-email-recovery.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3);

-- CreateIndex
-- Forgot-password looks an address up across every business, since the same address can own
-- accounts in more than one (users are only unique per [business_id, email]).
CREATE INDEX "users_email_idx" ON "users"("email");

-- Any row still in otp_codes belongs to the passwordless email-login flow that this change
-- removes: those codes can no longer be spent on anything, and none of them carry the user_id
-- the new column requires. Clearing them first is what lets user_id be NOT NULL.
DELETE FROM "otp_codes";

-- AlterTable
ALTER TABLE "otp_codes" ADD COLUMN     "user_id" TEXT NOT NULL,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET';

-- CreateIndex
CREATE INDEX "otp_codes_user_id_idx" ON "otp_codes"("user_id");

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
