import type { SchoolScope } from '../school/school-scope.service.js';
import type { StorageService } from '../../storage/storage.service.js';
import type { Letterhead } from './pdf.js';

const joined = (parts: (string | null)[], separator: string): string | null =>
  parts.filter(Boolean).join(separator) || null;

/** The school's letterhead details and logo, for printed documents. */
export async function loadBranding(
  scope: SchoolScope,
  storage: StorageService,
): Promise<{ letterhead: Letterhead; logo: Buffer | null }> {
  const school = await scope.tx.school.findUniqueOrThrow({
    where: { id: scope.schoolId },
    select: {
      name: true,
      motto: true,
      addressLine: true,
      city: true,
      county: true,
      country: true,
      phone: true,
      email: true,
      website: true,
      logoKey: true,
      logoContentType: true,
    },
  });

  let logo: Buffer | null = null;
  // PDFs can embed PNG and JPEG; other formats are left out.
  if (school.logoKey && ['image/png', 'image/jpeg'].includes(school.logoContentType ?? '')) {
    try {
      const object = await storage.get(school.logoKey);
      const chunks: Buffer[] = [];
      for await (const chunk of object.body) chunks.push(chunk as Buffer);
      logo = Buffer.concat(chunks);
    } catch {
      // A missing logo must not stop a document being produced.
      logo = null;
    }
  }

  return {
    letterhead: {
      name: school.name,
      motto: school.motto,
      address: joined([school.addressLine, school.city, school.county, school.country], ', '),
      contact: joined([school.phone, school.email, school.website], '  |  '),
    },
    logo,
  };
}
