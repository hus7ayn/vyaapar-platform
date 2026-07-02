import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { FilesService } from './files.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(PermissionsGuard)
export class FilesController {
  constructor(private files: FilesService) {}

  @Post('upload/:folder')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @RequirePermissions(Permission.INVENTORY_MANAGE, Permission.HOTEL_AADHAAR, Permission.EXPENSE_MANAGE)
  upload(
    @Param('folder') folder: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.files.upload(file, folder);
  }
}
