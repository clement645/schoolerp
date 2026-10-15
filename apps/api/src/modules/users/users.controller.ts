import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import type { Paginated } from '../../common/http/pagination.js';
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetUserPasswordDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './users.dto.js';
import { UsersService, type UserView } from './users.service.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: "List users in the caller's tenant" })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListUsersQueryDto,
  ): Promise<Paginated<UserView>> {
    return this.users.list(principal, query);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Get one user' })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserView> {
    return this.users.get(principal, id);
  }

  @Post()
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Create a user with a temporary password' })
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: CreateUserDto,
    @ClientMeta() meta: RequestMeta,
  ): Promise<UserView> {
    return this.users.create(principal, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: "Update a user's name or status" })
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @ClientMeta() meta: RequestMeta,
  ): Promise<UserView> {
    return this.users.update(principal, id, dto, meta);
  }

  @Put(':id/roles')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: "Replace a user's roles" })
  setRoles(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @ClientMeta() meta: RequestMeta,
  ): Promise<UserView> {
    return this.users.setRoles(principal, id, dto, meta);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Set a temporary password and end all of the user’s sessions' })
  resetPassword(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetUserPasswordDto,
    @ClientMeta() meta: RequestMeta,
  ): Promise<void> {
    return this.users.resetPassword(principal, id, dto, meta);
  }
}
