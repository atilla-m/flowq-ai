import asyncio
import json
import math

from backend.ai import AIProviderError


class BudgetExceeded(AIProviderError):
    pass


class CostBudget:
    """Reserve before each request, then reconcile with returned usage, across all workers."""
    def __init__(self, maximum: float, input_rate=2.0, output_rate=10.0):
        if not all(math.isfinite(n) and n >= 0 for n in (maximum, input_rate, output_rate)):
            raise ValueError("Cost cap and token rates must be finite and nonnegative")
        self.maximum, self.input_rate, self.output_rate = maximum, input_rate, output_rate
        self.spent, self.reserved, self.stopped, self.calls = 0.0, 0.0, False, 0
        self.input_tokens, self.output_tokens = 0, 0
        self.lock = asyncio.Lock()

    async def reserve(self, payload):
        # One UTF-8 byte per token + envelope allowance is deliberately conservative.
        # Include tools/instructions, and reserve the full output cap, not just visible text.
        incoming = len(json.dumps(payload, ensure_ascii=False, default=str).encode()) + 512
        outgoing = payload.get("max_output_tokens", 4096)
        estimate = (incoming * self.input_rate + outgoing * self.output_rate) / 1_000_000
        async with self.lock:
            if self.stopped or self.spent + self.reserved + estimate > self.maximum:
                self.stopped = True
                raise BudgetExceeded("Estimated cost cap reached; no further OpenAI requests will be made")
            self.reserved += estimate
        return estimate

    async def settle(self, reservation, response=None):
        usage = getattr(response, "usage", None)
        incoming = getattr(usage, "input_tokens", None)
        outgoing = getattr(usage, "output_tokens", None)
        actual = reservation if incoming is None or outgoing is None else (
            incoming * self.input_rate + outgoing * self.output_rate) / 1_000_000
        async with self.lock:
            self.reserved = max(0, self.reserved - reservation)
            self.spent += actual
            self.calls += 1
            self.input_tokens += incoming or 0
            self.output_tokens += outgoing or 0
            if self.spent >= self.maximum:
                self.stopped = True

    def summary(self):
        return {"estimated_cost_usd": round(self.spent, 6), "max_cost_usd": self.maximum,
                "budget_stopped": self.stopped, "api_calls": self.calls,
                "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
                "input_usd_per_million": self.input_rate, "output_usd_per_million": self.output_rate}


class MeteredResponses:
    def __init__(self, responses, budget):
        self.responses, self.budget = responses, budget

    async def create(self, **payload):
        reservation = await self.budget.reserve(payload)
        response = None
        try:
            response = await self.responses.create(**payload)
            return response
        finally:
            # Failed/unknown usage is charged at the reservation; retries are disabled.
            await self.budget.settle(reservation, response)
