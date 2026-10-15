import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Env } from '../config/env.schema.js';

export interface StoredObject {
  body: Readable;
  contentLength: number | undefined;
}

/**
 * Private object storage. Nothing here is ever exposed directly: files are
 * streamed to users by API endpoints that have already authorised the
 * request, so access rules live in one place.
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
      maxAttempts: 2,
    });
  }

  /** Fails start-up early when storage is unreachable, creating the bucket if needed. */
  async onModuleInit(): Promise<void> {
    if (!(await this.bucketExists())) {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (error) {
        // Several instances can start at once; losing the race to create the
        // bucket is fine as long as it exists afterwards.
        if (!(await this.bucketExists())) throw error;
      }
    }
    this.logger.log('Object storage connection established');
  }

  private async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  /** Throws unless the bucket is reachable. Used by the readiness probe. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * Builds a storage key. Keys are namespaced by tenant and end in a random
   * id, so they cannot be guessed and never collide or reveal a file name.
   */
  buildKey(tenantId: string, folder: string, extension: string): string {
    return `tenants/${tenantId}/${folder}/${randomUUID()}.${extension}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { body: result.Body as Readable, contentLength: result.ContentLength };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) {
        throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
      }
      throw error;
    }
  }

  /**
   * Deletes an object. Never throws: a file left behind after its database
   * record is gone is unreachable and harmless, whereas failing the user's
   * request over it would not be.
   */
  async remove(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.logger.warn(
        `Could not delete stored object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
