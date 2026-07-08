import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { FilesService } from './files.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const UPLOAD_PERMISSIONS = [Permission.INVENTORY_MANAGE, Permission.HOTEL_AADHAAR, Permission.EXPENSE_MANAGE];

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private files: FilesService) {}

  @Post('upload/:folder')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @Param('folder') folder: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('permissions') permissions: string[],
  ) {
    if (!UPLOAD_PERMISSIONS.some((p) => permissions?.includes(p))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.files.upload(file, folder);
  }
}
