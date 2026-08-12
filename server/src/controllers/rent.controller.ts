import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { getRentSummary, requestDue } from '../services/rent.service';

export const mySummary = asyncHandler(async (req: Request, res: Response) => {
  const summary = await getRentSummary(req.user!.id);
  res.json({ success: true, data: summary });
});

export const requestDueHandler = asyncHandler(async (req: Request, res: Response) => {
  const { mode, invoiceId } = req.body;
  const result = await requestDue({ userId: req.user!.id, mode, invoiceId });

  const { settlement } = result;
  const message =
    mode === 'ROLLOVER'
      ? `Rent deferred — ${settlement.rolledOver.toFixed(2)} carried to next month's invoice`
      : settlement.rolledOver > 0
        ? `${settlement.advanceDeducted.toFixed(2)} deducted from your advance; ` +
          `${settlement.rolledOver.toFixed(2)} carried to next month's invoice`
        : `${settlement.advanceDeducted.toFixed(2)} deducted from your advance deposit`;

  res.json({ success: true, data: { ...result, message } });
});
