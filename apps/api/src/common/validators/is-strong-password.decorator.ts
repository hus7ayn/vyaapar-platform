import { registerDecorator, ValidationOptions } from 'class-validator';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '@nexus/shared';

export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: { message: PASSWORD_POLICY_MESSAGE, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isStrongPassword(value),
      },
    });
  };
}
