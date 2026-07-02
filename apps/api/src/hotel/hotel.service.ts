import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, maskAadhaar } from '../common/utils/encryption.util';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class HotelService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  getRooms(businessId: string, branchId?: string) {
    return this.prisma.room.findMany({
      where: { businessId, ...(branchId && { branchId }) },
      include: { category: true, branch: true },
      orderBy: { roomNumber: 'asc' },
    });
  }

  createRoom(
    businessId: string,
    branchId: string,
    data: {
      roomNumber: string;
      categoryId: string;
      floor?: number;
      notes?: string;
      status?: string;
      price?: number;
    },
  ) {
    return this.prisma.room.create({
      data: {
        businessId,
        branchId,
        categoryId: data.categoryId,
        roomNumber: data.roomNumber,
        floor: data.floor ?? null,
        notes: data.notes,
        status: data.status ?? 'AVAILABLE',
        price: data.price !== undefined && data.price !== null ? data.price : null,
      },
      include: { category: true, branch: true },
    });
  }

  async updateRoom(
    businessId: string,
    roomId: string,
    data: {
      roomNumber?: string;
      categoryId?: string;
      floor?: number;
      notes?: string;
      status?: string;
      price?: number;
    },
  ) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, businessId } });
    if (!room) throw new NotFoundException('Room not found');

    return this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(data.roomNumber && { roomNumber: data.roomNumber }),
        ...(data.categoryId && { categoryId: data.categoryId }),
        ...(data.floor !== undefined && { floor: data.floor }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status && { status: data.status }),
        ...(data.price !== undefined && { price: data.price }),
      },
      include: { category: true, branch: true },
    });
  }

  getRoomCategories(businessId: string, branchId?: string) {
    return this.prisma.roomCategory.findMany({
      where: {
        businessId,
        ...(branchId
          ? {
              OR: [
                { branchId: branchId },
                { branchId: null },
              ],
            }
          : {}),
      },
    });
  }

  async getReservations(businessId: string, status?: string, branchId?: string) {
    const reservations = await this.prisma.reservation.findMany({
      where: { 
        businessId, 
        ...(status && { status }),
        ...(branchId && { branchId })
      },
      include: { room: true, guest: true, folioCharges: true },
      orderBy: { checkIn: 'asc' },
    });

    const reservationIds = reservations.map(r => r.id);
    const serviceRequests = await this.prisma.serviceRequest.findMany({
      where: { reservationId: { in: reservationIds } },
    });

    return reservations.map(r => ({
      ...r,
      serviceRequests: serviceRequests.filter(sr => sr.reservationId === r.id),
    }));
  }

  async getReservationWithDetails(businessId: string, id: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, businessId },
      include: { room: true, guest: true, folioCharges: true },
    });
    if (!reservation) return null;

    const serviceRequests = await this.prisma.serviceRequest.findMany({
      where: { reservationId: id },
    });

    return {
      ...reservation,
      serviceRequests,
    };
  }

  async checkOverlappingReservation(
    businessId: string,
    roomId: string,
    checkIn: Date | string,
    checkOut: Date | string,
    excludeReservationId?: string,
  ) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);

    const overlapping = await this.prisma.reservation.findFirst({
      where: {
        roomId,
        businessId,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lt: end },
        checkOut: { gt: start },
        ...(excludeReservationId && { id: { not: excludeReservationId } }),
      },
    });

    if (overlapping) {
      throw new BadRequestException('This room is already reserved or occupied for the selected dates');
    }
  }

  async getGuests(businessId: string, search?: string, branchId?: string) {
    return this.prisma.guest.findMany({
      where: {
        businessId,
        ...(branchId && { branchId }),
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        reservations: {
          select: { id: true, status: true, totalAmount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async checkIn(
    businessId: string,
    data: {
      roomId: string;
      guest: { firstName: string; lastName: string; phone?: string; email?: string; aadhaar?: string; aadhaarDocUrl?: string; idProofType?: string };
      checkIn: string;
      checkOut: string;
      roomRate: number;
    },
  ) {
    const room = await this.prisma.room.findFirst({
      where: { id: data.roomId, businessId, status: 'AVAILABLE' },
    });
    if (!room) throw new BadRequestException('Room not available');

    await this.checkOverlappingReservation(businessId, data.roomId, data.checkIn, data.checkOut);

    let aadhaarMasked: string | undefined;
    let aadhaarEncrypted: string | undefined;
    if (data.guest.aadhaar) {
      aadhaarMasked = maskAadhaar(data.guest.aadhaar);
      aadhaarEncrypted = encrypt(data.guest.aadhaar);
    }

    const guest = await this.prisma.guest.create({
      data: {
        businessId,
        branchId: room.branchId,
        firstName: data.guest.firstName,
        lastName: data.guest.lastName,
        phone: data.guest.phone,
        email: data.guest.email,
        aadhaarMasked,
        aadhaarEncrypted,
        aadhaarDocUrl: data.guest.aadhaarDocUrl,
        idProofType: data.guest.idProofType,
      },
    });

    const nights = Math.ceil(
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000,
    );
    const totalAmount = data.roomRate * nights;
    const bookingRef = `BK-${Date.now().toString(36).toUpperCase()}`;

    const [reservation] = await this.prisma.$transaction([
      this.prisma.reservation.create({
        data: {
          businessId,
          branchId: room.branchId,
          roomId: data.roomId,
          guestId: guest.id,
          bookingRef,
          status: 'CHECKED_IN',
          checkIn: new Date(data.checkIn),
          checkOut: new Date(data.checkOut),
          roomRate: data.roomRate,
          totalAmount,
          checkedInAt: new Date(),
        },
        include: { room: true, guest: true },
      }),
      this.prisma.room.update({
        where: { id: data.roomId },
        data: { status: 'OCCUPIED' },
      }),
    ]);

    this.events.emitRoomUpdate(businessId, reservation);
    return reservation;
  }

  async checkOut(businessId: string, reservationId: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, businessId, status: 'CHECKED_IN' },
      include: { room: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Find all service requests for this reservation
      const serviceRequests = await tx.serviceRequest.findMany({
        where: {
          reservationId: reservation.id,
          amount: { not: null },
        },
      });

      // 2. Add them as folio charges if they are not already added (to prevent duplicates)
      for (const req of serviceRequests) {
        const existingCharge = await tx.folioCharge.findFirst({
          where: {
            reservationId: reservation.id,
            description: { startsWith: req.serviceType.replace('_', ' ') },
            amount: req.amount!,
          },
        });
        if (!existingCharge) {
          await tx.folioCharge.create({
            data: {
              reservationId: reservation.id,
              description: `${req.serviceType.replace('_', ' ')}: ${req.description || 'Request'}`,
              amount: req.amount!,
              chargeType: 'SERVICE',
            },
          });
        }
      }

      // 3. Fetch all folio charges including the newly created ones
      const folioCharges = await tx.folioCharge.findMany({
        where: { reservationId: reservation.id },
      });

      const extraTotal = folioCharges.reduce(
        (sum, c) => sum + Number(c.amount),
        0,
      );
      const pending = Number(reservation.totalAmount) + extraTotal - Number(reservation.paidAmount);

      const res = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), extraCharges: extraTotal },
        include: { guest: true, room: true },
      });

      await tx.room.update({ where: { id: reservation.roomId }, data: { status: 'CLEANING' } });
      await tx.housekeepingTask.create({
        data: { businessId, roomId: reservation.roomId, status: 'PENDING', priority: 'HIGH' },
      });

      return res;
    });

    const finalRes = await this.getReservationWithDetails(businessId, reservationId);
    this.events.emitRoomUpdate(businessId, finalRes);
    return finalRes;
  }

  async createReservation(
    businessId: string,
    data: {
      roomId: string;
      guestId?: string;
      guest?: { firstName: string; lastName: string; phone?: string; email?: string };
      checkIn: string;
      checkOut: string;
      roomRate: number;
      source?: string;
    },
  ) {
    const room = await this.prisma.room.findFirst({
      where: { id: data.roomId, businessId },
    });
    if (!room) throw new NotFoundException('Room not found');

    await this.checkOverlappingReservation(businessId, data.roomId, data.checkIn, data.checkOut);

    let guestId = data.guestId;
    if (!guestId && data.guest) {
      const guest = await this.prisma.guest.create({
        data: { businessId, branchId: room.branchId, ...data.guest },
      });
      guestId = guest.id;
    }
    if (!guestId) throw new BadRequestException('Guest required');

    const nights = Math.ceil(
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000,
    );
    const bookingRef = `BK-${Date.now().toString(36).toUpperCase()}`;

    const reservation = await this.prisma.reservation.create({
      data: {
        businessId,
        branchId: room.branchId,
        roomId: data.roomId,
        guestId,
        bookingRef,
        status: 'CONFIRMED',
        source: data.source || 'MANUAL',
        checkIn: new Date(data.checkIn),
        checkOut: new Date(data.checkOut),
        roomRate: data.roomRate,
        totalAmount: data.roomRate * nights,
      },
      include: { room: true, guest: true },
    });

    await this.prisma.room.update({
      where: { id: data.roomId },
      data: { status: 'RESERVED' },
    });

    this.events.emitRoomUpdate(businessId, reservation);
    return reservation;
  }

  async getCalendar(businessId: string, from: string, to: string, branchId?: string) {
    return this.prisma.reservation.findMany({
      where: {
        businessId,
        checkIn: { lte: new Date(to) },
        checkOut: { gte: new Date(from) },
        status: { notIn: ['CANCELLED'] },
        ...(branchId && { branchId }),
      },
      include: { room: true, guest: true },
    });
  }

  async updateReservation(businessId: string, id: string, data: { checkIn?: string; checkOut?: string; roomId?: string; status?: string; paidAmount?: number }) {
    const reservation = await this.prisma.reservation.findFirst({ where: { id, businessId } });
    if (!reservation) throw new NotFoundException('Reservation not found');

    const roomId = data.roomId || reservation.roomId;
    const start = data.checkIn ? new Date(data.checkIn) : reservation.checkIn;
    const end = data.checkOut ? new Date(data.checkOut) : reservation.checkOut;
    const status = data.status || reservation.status;

    if (['CONFIRMED', 'CHECKED_IN'].includes(status)) {
      await this.checkOverlappingReservation(businessId, roomId, start, end, id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.update({
        where: { id },
        data: {
          ...(data.checkIn && { checkIn: new Date(data.checkIn) }),
          ...(data.checkOut && { checkOut: new Date(data.checkOut) }),
          ...(data.roomId && { roomId: data.roomId }),
          ...(data.status && { status: data.status }),
          ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
        },
        include: { room: true, guest: true },
      });

      // Handle room status updates on reservation status change
      if (data.status === 'CHECKED_IN') {
        await tx.room.update({
          where: { id: res.roomId },
          data: { status: 'OCCUPIED' },
        });
      } else if (data.status === 'CANCELLED') {
        await tx.room.update({
          where: { id: res.roomId },
          data: { status: 'AVAILABLE' },
        });
      } else if (data.status === 'CONFIRMED') {
        await tx.room.update({
          where: { id: res.roomId },
          data: { status: 'RESERVED' },
        });
      }

      return res;
    });

    const finalRes = await this.getReservationWithDetails(businessId, id);
    this.events.emitRoomUpdate(businessId, finalRes);
    return finalRes;
  }

  async addFolioCharge(businessId: string, reservationId: string, data: { description: string; amount: number; chargeType?: string }) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, businessId }
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    await this.prisma.folioCharge.create({
      data: {
        reservationId,
        description: data.description,
        amount: data.amount,
        chargeType: data.chargeType || 'MISC',
      },
    });

    return this.getReservationWithDetails(businessId, reservationId);
  }

  async cancelReservation(businessId: string, id: string, data?: { cancellationFee?: number; refundAmount?: number }) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, businessId },
      include: { room: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    return this.prisma.$transaction(async (tx) => {
      // Create cancellation fee folio charge
      if (data?.cancellationFee && data.cancellationFee > 0) {
        await tx.folioCharge.create({
          data: {
            reservationId: id,
            description: 'Cancellation Fee',
            amount: data.cancellationFee,
            chargeType: 'FEE',
          },
        });
      }

      // Create refund folio charge
      if (data?.refundAmount && data.refundAmount > 0) {
        await tx.folioCharge.create({
          data: {
            reservationId: id,
            description: 'Refund (Cancellation)',
            amount: -data.refundAmount,
            chargeType: 'REFUND',
          },
        });
        
        // Update paid amount on reservation
        await tx.reservation.update({
          where: { id },
          data: {
            paidAmount: { decrement: data.refundAmount },
          },
        });
      }

      const updated = await tx.reservation.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: { room: true, guest: true, folioCharges: true },
      });

      await tx.room.update({
        where: { id: reservation.roomId },
        data: { status: 'AVAILABLE' },
      });

      this.events.emitRoomUpdate(businessId, updated);
      return updated;
    });
  }

  createRoomCategory(
    businessId: string,
    branchId: string,
    data: { name: string; description?: string; basePrice: number; maxGuests?: number; amenities?: string[] },
  ) {
    return this.prisma.roomCategory.create({
      data: {
        businessId,
        branchId,
        name: data.name,
        description: data.description,
        basePrice: data.basePrice,
        maxGuests: data.maxGuests ?? 2,
        amenities: data.amenities ?? [],
      },
    });
  }

  updateRoomCategory(businessId: string, id: string, data: Partial<{ name: string; description: string; basePrice: number; maxGuests: number; amenities: string[] }>) {
    return this.prisma.roomCategory.updateMany({
      where: { id, businessId },
      data: data as never,
    });
  }

  async addFolioPayment(businessId: string, reservationId: string, data: { method: string; amount: number; reference?: string }) {
    const reservation = await this.prisma.reservation.findFirst({ where: { id: reservationId, businessId } });
    if (!reservation) throw new NotFoundException('Reservation not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.folioPayment.create({
        data: { businessId, reservationId, method: data.method, amount: data.amount, reference: data.reference },
      });
      await tx.reservation.update({
        where: { id: reservationId },
        data: { paidAmount: { increment: data.amount } },
      });
    });

    return this.getReservationWithDetails(businessId, reservationId);
  }

  getFolioPayments(businessId: string, reservationId: string) {
    return this.prisma.folioPayment.findMany({
      where: { businessId, reservationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async runNightAudit(businessId: string, branchId: string, userId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rooms = await this.prisma.room.findMany({ where: { businessId, branchId } });
    const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length;
    const totalRooms = rooms.length;

    const reservations = await this.prisma.reservation.findMany({
      where: {
        businessId,
        branchId,
        status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
        checkIn: { lte: today },
        checkOut: { gte: today },
      },
    });

    const roomRevenue = reservations.reduce((s, r) => s + Number(r.roomRate), 0);
    const adr = occupied > 0 ? roomRevenue / occupied : 0;
    const revpar = totalRooms > 0 ? roomRevenue / totalRooms : 0;
    const occupancyRate = totalRooms > 0 ? (occupied / totalRooms) * 100 : 0;

    return this.prisma.nightAuditLog.upsert({
      where: { businessId_branchId_auditDate: { businessId, branchId, auditDate: today } },
      create: {
        businessId,
        branchId,
        auditDate: today,
        roomsOccupied: occupied,
        totalRooms,
        roomRevenue,
        adr,
        revpar,
        occupancyRate,
        runBy: userId,
        notes: 'Night audit completed',
      },
      update: { roomsOccupied: occupied, roomRevenue, adr, revpar, occupancyRate, runBy: userId },
    });
  }

  getNightAudits(businessId: string, branchId?: string) {
    return this.prisma.nightAuditLog.findMany({
      where: { businessId, ...(branchId && { branchId }) },
      orderBy: { auditDate: 'desc' },
      take: 30,
    });
  }

  setRoomRate(businessId: string, branchId: string, data: { categoryId: string; rateDate: string; rate: number }) {
    const rateDate = new Date(data.rateDate);
    return this.prisma.roomRate.upsert({
      where: {
        businessId_branchId_categoryId_rateDate: {
          businessId,
          branchId,
          categoryId: data.categoryId,
          rateDate,
        },
      },
      create: { businessId, branchId, categoryId: data.categoryId, rateDate, rate: data.rate },
      update: { rate: data.rate },
    });
  }

  getRoomRates(businessId: string, branchId: string, from: string, to: string) {
    return this.prisma.roomRate.findMany({
      where: {
        businessId,
        branchId,
        rateDate: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { rateDate: 'asc' },
    });
  }

  async getRevenueMetrics(businessId: string, branchId?: string) {
    const rooms = await this.prisma.room.findMany({ where: { businessId, ...(branchId && { branchId }) } });
    const totalRooms = rooms.length;
    const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        businessId,
        ...(branchId && { branchId }),
        status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
        checkIn: { gte: monthStart },
      },
    });

    const roomNights = reservations.reduce((s, r) => {
      const nights = Math.max(1, Math.ceil((new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime()) / 86400000));
      return s + nights;
    }, 0);

    const roomRevenue = reservations.reduce((s, r) => s + Number(r.totalAmount), 0);
    const adr = roomNights > 0 ? roomRevenue / roomNights : 0;
    const revpar = totalRooms > 0 ? roomRevenue / (totalRooms * 30) : 0;

    const audits = await this.prisma.nightAuditLog.findMany({
      where: { businessId, ...(branchId && { branchId }) },
      orderBy: { auditDate: 'desc' },
      take: 7,
    });

    return {
      adr: Math.round(adr * 100) / 100,
      revpar: Math.round(revpar * 100) / 100,
      occupancyRate: totalRooms ? Math.round((occupied / totalRooms) * 100) : 0,
      roomRevenue,
      roomNights,
      totalRooms,
      occupied,
      auditHistory: audits,
    };
  }
}
