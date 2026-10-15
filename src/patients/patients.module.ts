import { Module } from '@nestjs/common';
import { PatientsService } from './patients.service.js';
import { PatientExportService } from './patient-export.service.js';
import { PatientConsentsService } from './patient-consents.service.js';
import { PatientsController } from './patients.controller.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [PatientsController],
  providers: [PatientsService, PatientExportService, PatientConsentsService],
  exports: [PatientsService],
})
export class PatientsModule {}
