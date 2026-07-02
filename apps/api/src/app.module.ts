import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BusinessesModule } from './businesses/businesses.module';
import { BranchesModule } from './branches/branches.module';
import { UsersModule } from './users/users.module';
import { TxnsModule } from './txns/txns.module';
import { PartiesModule } from './parties/parties.module';
import { ItemsModule } from './items/items.module';
import { SaleModule } from './sale/sale.module';
import { PurchaseModule } from './purchase/purchase.module';
import { CashBankModule } from './cash-bank/cash-bank.module';
import { SettingsModule } from './settings/settings.module';
import { UtilitiesModule } from './utilities/utilities.module';
import { CategoriesModule } from './categories/categories.module';
import { InventoryModule } from './inventory/inventory.module';
import { HotelModule } from './hotel/hotel.module';
import { HousekeepingModule } from './housekeeping/housekeeping.module';
import { ServicesModule } from './services/services.module';
import { PayrollModule } from './payroll/payroll.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SyncModule } from './sync/sync.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { FilesModule } from './files/files.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { ExportsModule } from './exports/exports.module';
import { AuditModule } from './audit/audit.module';
import { QueuesModule } from './queues/queues.module';
import { ShiftsModule } from './shifts/shifts.module';
import { PlatformModule } from './platform/platform.module';
import { RemindersModule } from './reminders/reminders.module';
import { InsightsModule } from './insights/insights.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    }),
    PrismaModule,
    AuthModule,
    BusinessesModule,
    BranchesModule,
    UsersModule,
    TxnsModule,
    PartiesModule,
    ItemsModule,
    SaleModule,
    PurchaseModule,
    CashBankModule,
    SettingsModule,
    UtilitiesModule,
    CategoriesModule,
    InventoryModule,
    HotelModule,
    HousekeepingModule,
    ServicesModule,
    PayrollModule,
    ExpensesModule,
    ReportsModule,
    NotificationsModule,
    SyncModule,
    EventsModule,
    HealthModule,
    FilesModule,
    ReceiptsModule,
    ExportsModule,
    AuditModule,
    QueuesModule,
    ShiftsModule,
    PlatformModule,
    RemindersModule,
    InsightsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
