import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ROLE_PERMISSIONS } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll(businessId: string) {
    return this.prisma.user.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        branchId: true,
        lastLoginAt: true,
      },
    });
  }

  async create(
    businessId: string,
    data: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: string;
      branchId?: string;
    },
  ) {
    const passwordHash = await bcrypt.hash(data.password, 12);
    const permissions = ROLE_PERMISSIONS[data.role] ?? [];
    return this.prisma.user.create({
      data: {
        businessId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        branchId: data.branchId,
        permissions,
      },
    });
  }
}
