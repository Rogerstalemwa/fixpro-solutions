import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { config, isServedDistrict } from '../../config.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';

const router = Router();

router.get(
  '/service-categories',
  asyncHandler(async (_req, res) => {
    const data = await prisma.serviceCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    ok(res, data);
  })
);

router.get(
  '/services',
  asyncHandler(async (req, res) => {
    const data = await prisma.service.findMany({
      where: { active: true, ...(req.query.categoryId && { categoryId: String(req.query.categoryId) }) },
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
    ok(res, data);
  })
);

router.get(
  '/services/:id',
  asyncHandler(async (req, res) => {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, active: true },
      include: { category: true },
    });
    if (!service) throw new ApiError(404, 'Service not found');
    ok(res, service);
  })
);

router.get('/service-areas', (_req, res) => ok(res, config.serviceDistricts));

router.post(
  '/service-availability/check',
  asyncHandler(async (req, res) => {
    const { district } = z.object({ district: z.string().trim().min(1, 'District is required') }).parse(req.body);
    ok(res, { district, available: isServedDistrict(district) });
  })
);

export default router;
