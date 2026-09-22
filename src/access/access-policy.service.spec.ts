import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessPolicyService, MANAGEMENT_PERMISSIONS } from './access-policy.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

const actor = (...permissions: string[]): AuthenticatedUser => ({
  userId: 'actor',
  tenantId: 't1',
  roleId: 'r1',
  permissions,
});

function setup() {
  const prisma = {
    user: {
      count: vi.fn(async (_args?: { where: { tenantId: string; status: string; AND: unknown[] } }) => 1),
    },
    permission: { findMany: vi.fn() },
    role: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const policy = new AccessPolicyService(prisma as unknown as PrismaService);
  return { prisma, policy, db: prisma as never };
}

describe('AccessPolicyService.assertCanGrant', () => {
  const { policy } = setup();

  it('allows granting a subset of what the actor holds', () => {
    expect(() =>
      policy.assertCanGrant(actor('a', 'b', 'c'), ['a', 'c']),
    ).not.toThrow();
    expect(() => policy.assertCanGrant(actor('a'), [])).not.toThrow();
  });

  it('forbids granting anything the actor lacks and names what is missing', () => {
    expect(() => policy.assertCanGrant(actor('a'), ['a', 'b', 'c'])).toThrow(ForbiddenException);
    expect(() => policy.assertCanGrant(actor('a'), ['a', 'b', 'c'])).toThrow(/b, c/);
  });
});

describe('AccessPolicyService.assertCanManage', () => {
  const { policy } = setup();

  it('allows managing a target at or below the actor', () => {
    expect(() => policy.assertCanManage(actor('a', 'b'), ['a'], 'usuário')).not.toThrow();
    expect(() => policy.assertCanManage(actor('a'), [], 'papel')).not.toThrow();
  });

  it('forbids managing a target with permissions the actor lacks', () => {
    expect(() => policy.assertCanManage(actor('a'), ['a', 'b'], 'usuário')).toThrow(
      /usuário com permissões/,
    );
    expect(() => policy.assertCanManage(actor('a'), ['b'], 'papel')).toThrow(ForbiddenException);
  });
});

describe('AccessPolicyService.permissionKeysByIds', () => {
  it('returns the keys for known ids', async () => {
    const { prisma, policy, db } = setup();
    prisma.permission.findMany.mockResolvedValue([{ key: 'a' }, { key: 'b' }]);

    await expect(policy.permissionKeysByIds(db, ['1', '2'])).resolves.toEqual(['a', 'b']);
  });

  it('rejects unknown ids with 400 instead of leaking a foreign-key error', async () => {
    const { prisma, policy, db } = setup();
    prisma.permission.findMany.mockResolvedValue([{ key: 'a' }]);

    await expect(policy.permissionKeysByIds(db, ['1', '2'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not hit the database for an empty list', async () => {
    const { prisma, policy, db } = setup();

    await expect(policy.permissionKeysByIds(db, [])).resolves.toEqual([]);
    expect(prisma.permission.findMany).not.toHaveBeenCalled();
  });
});

describe('AccessPolicyService.roleKeys', () => {
  it('returns null for a role outside the tenant', async () => {
    const { prisma, policy, db } = setup();
    prisma.role.findFirst.mockResolvedValue(null);

    await expect(policy.roleKeys(db, 't1', 'foreign')).resolves.toBeNull();
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign', tenantId: 't1' } }),
    );
  });
});

describe('AccessPolicyService.withAdminGuard', () => {
  it('counts only active users holding every management permission', async () => {
    const { prisma, policy } = setup();

    await policy.withAdminGuard('t1', async () => 'ok');

    const where = prisma.user.count.mock.calls[0][0]!.where;
    expect(where).toMatchObject({ tenantId: 't1', status: 'active' });
    expect(where.AND).toHaveLength(MANAGEMENT_PERMISSIONS.length);
  });

  it('fails with 409 when the work leaves the tenant with no admin', async () => {
    const { prisma, policy } = setup();
    prisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(policy.withAdminGuard('t1', async () => 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lets it through when the tenant already had no admin (not made worse)', async () => {
    const { prisma, policy } = setup();
    prisma.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await expect(policy.withAdminGuard('t1', async () => 'x')).resolves.toBe('x');
  });

  it('returns the work result when an admin remains', async () => {
    const { prisma, policy } = setup();
    prisma.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    await expect(policy.withAdminGuard('t1', async () => 'done')).resolves.toBe('done');
  });
});
