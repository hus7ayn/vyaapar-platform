import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

const MUTATIONS = ['POST', 'PUT', 'PATCH', 'DELETE'];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = req.method as string;

    if (!MUTATIONS.includes(method) || !req.user?.businessId) {
      return next.handle();
    }

    const entity = (req.url as string).split('/')[3] || 'unknown';

    return next.handle().pipe(
      tap(() => {
        this.audit
          .log({
            businessId: req.user.businessId,
            userId: req.user.sub,
            action: method,
            entity,
            ipAddress: req.ip,
            metadata: { path: req.url, params: req.params },
          })
          .catch(() => undefined);
      }),
    );
  }
}
