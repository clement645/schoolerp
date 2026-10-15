import { describeS3Error } from './storage.service.js';

describe('describeS3Error', () => {
  it('reports the code, the reason and the status', () => {
    expect(
      describeS3Error({
        name: 'InvalidArgument',
        message: 'Credential access key has length 40, should be 32',
        $metadata: { httpStatusCode: 400 },
      }),
    ).toBe('InvalidArgument: Credential access key has length 40, should be 32 (HTTP 400)');
  });

  it('does not repeat an empty reason', () => {
    expect(
      describeS3Error({
        name: 'Unknown',
        message: 'UnknownError',
        $metadata: { httpStatusCode: 400 },
      }),
    ).toBe('Unknown (HTTP 400)');
    expect(describeS3Error(new Error('connect ECONNREFUSED'))).toBe('Error: connect ECONNREFUSED');
  });
});
