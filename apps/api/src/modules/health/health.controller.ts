import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators.js';
import { HealthService } from './health.service.js';
import type { HealthReport, LivenessReport } from './health.types.js';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — the process is running' })
  @ApiResponse({ status: 200, description: 'The API process is alive.' })
  live(): LivenessReport {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Readiness probe — the API and its dependencies are reachable' })
  @ApiResponse({ status: 200, description: 'All dependencies are reachable.' })
  @ApiResponse({ status: 503, description: 'At least one dependency is unreachable.' })
  async ready(): Promise<HealthReport> {
    const report = await this.health.check();

    if (report.status !== 'ok') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'One or more dependencies are unavailable.',
        details: report,
      });
    }

    return report;
  }
}
