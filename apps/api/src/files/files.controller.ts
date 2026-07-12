import {
  Controller,
  Get,
  Post,
  Query,
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
import { Public } from '../common/decorators/public.decorator';

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

  // Public but access-gated by an HMAC token in the URL (disk-storage mode) —
  // browsers hit this directly for <img>/<a>, so it can't require a bearer header.
  @Public()
  @Get('serve/:folder/:name')
  serve(
    @Param('folder') folder: string,
    @Param('name') name: string,
    @Query('t') token: string,
  ) {
    return this.files.readSigned(`${folder}/${name}`, token);
  }
}
