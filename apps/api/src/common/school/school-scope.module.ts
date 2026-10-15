import { Global, Module } from '@nestjs/common';
import { ClassScopeService } from './class-scope.service.js';
import { SchoolScopeService } from './school-scope.service.js';

@Global()
@Module({
  providers: [SchoolScopeService, ClassScopeService],
  exports: [SchoolScopeService, ClassScopeService],
})
export class SchoolScopeModule {}
