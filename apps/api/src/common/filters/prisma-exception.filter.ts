import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Turns raw Prisma errors into clear, user-facing HTTP responses instead of a
 * blanket 500 "Internal server error". The most common case is P2002 (a unique
 * constraint) — e.g. creating an item with an Item Code/SKU that already exists.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const mapped = this.map(exception);
    response.status(mapped.getStatus()).json({
      statusCode: mapped.getStatus(),
      message: mapped.message,
      error: HttpStatus[mapped.getStatus()] ?? 'Error',
    });
  }

  private map(exception: Prisma.PrismaClientKnownRequestError): HttpException {
    switch (exception.code) {
      case 'P2002': {
        // Unique constraint violation. meta.target is the offending field(s)
        // (Postgres often reports the index/constraint name as a single string).
        const target = this.fieldsOf(exception);
        return new ConflictException(this.uniqueMessage(target));
      }
      case 'P2025':
        // Record not found (update/delete of a missing row).
        return new NotFoundException('The requested record was not found.');
      case 'P2003':
        // Foreign-key constraint failure.
        return new ConflictException(
          'This record is linked to other data and cannot be changed or deleted.',
        );
      default:
        // Fall through to Nest's default 500 for anything we don't specifically map.
        return new HttpException(
          'A database error occurred. Please try again.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
  }

  private fieldsOf(exception: Prisma.PrismaClientKnownRequestError): string {
    const target = (exception.meta as { target?: string | string[] } | undefined)?.target;
    if (Array.isArray(target)) return target.join(', ').toLowerCase();
    if (typeof target === 'string') return target.toLowerCase();
    return '';
  }

  private uniqueMessage(target: string): string {
    if (target.includes('sku')) return 'An item with this Item Code (SKU) already exists.';
    if (target.includes('barcode')) return 'An item with this barcode already exists.';
    if (target.includes('phone')) return 'A record with this phone number already exists.';
    if (target.includes('email')) return 'A record with this email already exists.';
    if (target.includes('gstin')) return 'A party with this GSTIN already exists.';
    if (target.includes('slug') || target.includes('name'))
      return 'A record with this name already exists.';
    if (target.includes('invoicenumber') || target.includes('number'))
      return 'This number is already in use.';
    return 'A record with these details already exists.';
  }
}
