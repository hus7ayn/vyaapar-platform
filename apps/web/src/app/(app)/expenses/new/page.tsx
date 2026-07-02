'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TxnForm } from '@/components/vyapar/txn-form';
import { VyaparPageHeader } from '@/components/vyapar/page-header';

export default function NewExpensePage() {
  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl">
      <VyaparPageHeader
        title="New Expense"
        action={
          <Link href="/expenses">
            <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
        }
      />
      <TxnForm txnType="EXPENSE" />
    </div>
  );
}
