import { slugify } from './tenants.service.js';

describe('slugify', () => {
  it('produces a lowercase, hyphenated slug', () => {
    expect(slugify('Green Valley Academy')).toBe('green-valley-academy');
    expect(slugify("  St. Mary's   School — Nairobi ")).toBe('st-mary-s-school-nairobi');
  });

  it('strips accents', () => {
    expect(slugify('École Élémentaire')).toBe('ecole-elementaire');
  });

  it('caps the length and never returns an empty slug', () => {
    expect(slugify('a'.repeat(200)).length).toBe(48);
    expect(slugify('!!!')).toBe('tenant');
  });
});
