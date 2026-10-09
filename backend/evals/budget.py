import asyncio
import json
import math

from backend.ai import AIProviderError


class BudgetExceeded(AIProviderError):
    pass


class CostBudget:
    """Reserve before each request, then reconcile with returned usage, across all workers."""
    def __init__(self, maximum: float, input_rate=2.0, output_rate=10.0, *, model_rates=None, checkpoint=None,
                 initial_spent=0):
        if not all(math.isfinite(n) and n >= 0 for n in (maximum, input_rate, output_rate)):
            raise ValueError("Cost cap and token rates must be finite and nonnegative")
        self.maximum, self.input_rate, self.output_rate = maximum, input_rate, output_rate
        self.spent, self.reserved, self.stopped, self.calls = 0.0, 0.0, False, 0
        self.input_tokens, self.output_tokens = 0, 0
        self.lock = asyncio.Lock()
        self.model_rates = model_rates or {}
        if any(not math.isfinite(rate) or rate < 0 for rates in self.model_rates.values() for rate in rates):
            raise ValueError("Model rates must be finite and nonnegative")
        if not math.isfinite(initial_spent) or not 0 <= initial_spent <= maximum:
            raise ValueError("Initial spend must be finite and within the cap")
        self.spent = initial_spent
        self.prior_spend = initial_spent
        self.checkpoint = checkpoint
        self.by_model = {}
        self.token_count_calls = 0

    def save(self):
        if self.checkpoint:
            self.checkpoint.write_text(json.dumps(self.summary(), indent=2))

    def rates(self, model):
        return self.model_rates.get(model, (self.input_rate, self.output_rate))

    async def reserve(self, payload, input_tokens=None):
        # One UTF-8 byte per token + envelope allowance is deliberately conservative.
        # Include tools/instructions, and reserve the full output cap, not just visible text.
        incoming = (input_tokens + 64) if input_tokens is not None else len(json.dumps(payload, ensure_ascii=False, default=str).encode()) + 512
        outgoing = payload.get("max_output_tokens", 4096)
        input_rate, output_rate = self.rates(payload.get("model"))[:2]
        estimate = (incoming * input_rate + outgoing * output_rate) / 1_000_000
        async with self.lock:
            if self.stopped or self.spent + self.reserved + estimate > self.maximum:
                self.stopped = True
                self.save()
                raise BudgetExceeded("Estimated cost cap reached; no further OpenAI requests will be made")
            self.reserved += estimate
            self.save()
        return estimate

    async def settle(self, reservation, response=None, model=None):
        usage = getattr(response, "usage", None)
        incoming = getattr(usage, "input_tokens", None)
        outgoing = getattr(usage, "output_tokens", None)
        rates = self.rates(model)
        input_rate, output_rate = rates[:2]
        cached = getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0) or 0
        cached_rate = rates[2] if len(rates) > 2 else input_rate
        actual = reservation if incoming is None or outgoing is None else (
            (incoming - cached) * input_rate + cached * cached_rate + outgoing * output_rate) / 1_000_000
        async with self.lock:
            self.reserved = max(0, self.reserved - reservation)
            self.spent += actual
            self.calls += 1
            self.input_tokens += incoming or 0
            self.output_tokens += outgoing or 0
            if model:
                row = self.by_model.setdefault(model, {"api_calls": 0, "input_tokens": 0, "output_tokens": 0,
                    "cached_input_tokens": 0, "estimated_cost_usd": 0, "input_usd_per_million": input_rate,
                    "output_usd_per_million": output_rate, "cached_input_usd_per_million": cached_rate})
                row["api_calls"] += 1
                row["input_tokens"] += incoming or 0
                row["output_tokens"] += outgoing or 0
                row["cached_input_tokens"] += cached
                row["estimated_cost_usd"] += actual
            if self.spent >= self.maximum:
                self.stopped = True
            self.save()

    def summary(self):
        return {"estimated_cost_usd": round(self.spent, 6), "max_cost_usd": self.maximum,
                "budget_stopped": self.stopped, "api_calls": self.calls,
                "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
                "input_usd_per_million": self.input_rate, "output_usd_per_million": self.output_rate,
                "by_model": self.by_model, "outstanding_reservations_usd": self.reserved,
                "prior_spend_allowance_usd": self.prior_spend, "token_count_calls": self.token_count_calls}


class MeteredResponses:
    def __init__(self, responses, budget):
        self.responses, self.budget = responses, budget

    async def create(self, **payload):
        incoming = None
        counter = getattr(self.responses, "input_tokens", None)
        if self.budget.stopped:
            raise BudgetExceeded("Estimated cost cap reached; no further OpenAI requests will be made")
        if counter is not None:
            count_keys = {"model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls",
                          "reasoning", "text", "conversation", "previous_response_id", "truncation"}
            try:
                counted = await counter.count(**{key: value for key, value in payload.items() if key in count_keys})
                if isinstance(counted.input_tokens, int) and counted.input_tokens >= 0:
                    incoming = counted.input_tokens
                    self.budget.token_count_calls += 1
            except Exception:
                # If token counting is unavailable, keep the byte-based upper bound.
                pass
        reservation = await self.budget.reserve(payload, incoming)
        response = None
        try:
            response = await self.responses.create(**payload)
            return response
        finally:
            # Failed/unknown usage is charged at the reservation; retries are disabled.
            await self.budget.settle(reservation, response, payload.get("model"))
