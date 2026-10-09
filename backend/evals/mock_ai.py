"""Scripted provider double; real ChatAgent, API routes, tools and scoring stay in use."""
import json
from types import SimpleNamespace
from uuid import uuid4

from backend.evals.fixtures import FixtureVisionAI


class FunctionCall:
    type = "function_call"

    def __init__(self, name, args):
        self.name, self.arguments, self.call_id = name, json.dumps(args), "call_" + uuid4().hex

    def model_dump(self, **kwargs):
        return {"type": "function_call", "name": self.name, "arguments": self.arguments, "call_id": self.call_id}


class MockShopAI(FixtureVisionAI):
    def __init__(self, settings, scenario):
        super().__init__(settings)
        self.scenario, self.facts = scenario, scenario["hidden_facts"]
        self.db = self.phone = None
        self.turn, self.pending, self.results = 0, [], {}

    def require_client(self):
        return self

    async def close(self):
        pass

    async def summarize(self, transcript):
        return transcript

    def stages(self):
        category = self.scenario["category"]
        common = [["search_inventory", "calculate_delivery", "get_accessories"], ["create_order", "create_payment_link"], ["check_payment_status", "get_order_status"]]
        if self.facts.get("policy_topic"):
            common[0] += ["get_store_policy", "check_installment", "find_branch"]
        if category == "cross_channel_memory":
            common[0].insert(0, "get_customer_history")
        if category == "fake_payment":
            common.append(["check_payment_status"])
        if category == "out_of_stock":
            return [["search_inventory"], common[0], common[1], common[2]]
        if category == "unknown_district":
            return [["search_inventory", "calculate_delivery"], ["calculate_delivery", "get_accessories"], common[1], common[2]]
        if category in ("tradein_honest", "tradein_lying", "negotiation_pushy"):
            steps = [["search_inventory", "request_media_whatsapp"], ["analyze_device_media", "calculate_tradein", "calculate_delivery", "get_accessories"]]
            if category == "negotiation_pushy":
                steps += [["negotiate_offer"]] * 3
            return steps + [common[1], common[2]]
        if category == "angry_handoff":
            return [["search_inventory"], ["handoff_to_human"]]
        return common

    def arguments(self, name):
        facts = self.facts
        if name == "search_inventory":
            return {"query": facts.get("requested_query") if self.scenario["category"] == "out_of_stock" and self.turn == 1 else facts["target_query"],
                    **facts.get("inventory_filters", {})}
        if name == "get_store_policy":
            return {"topic": facts["policy_topic"]}
        if name == "check_installment":
            return {"sku": facts["target_sku"], "months": facts["installment_months"]}
        if name == "find_branch":
            return {"district": facts["branch_district"]}
        if name == "calculate_delivery":
            return {"address": facts.get("resolved_address", facts["address"]) if self.turn > 1 else facts["address"]}
        if name == "get_accessories":
            return {"phone_model": facts["phone_model"]}
        if name == "request_media_whatsapp":
            return {"what": "Please send your trade-in photos."}
        if name == "analyze_device_media":
            return {"claimed": facts["claimed"], "media_ids": self.db.history(self.phone)["recent_media_ids"]}
        if name == "calculate_tradein":
            return {"device_info": {"analysis_id": self.results["analyze_device_media"]["analysis_id"], **facts["checklist"]}}
        if name == "negotiate_offer":
            quote = self.results["calculate_tradein"]
            return {"quote_id": quote["quote_id"], "customer_ask": round(quote["final_offer"] * (1 + facts["ask_pct"] / 100), 2)}
        if name == "create_order":
            args = {"items": [{"sku": facts["target_sku"]}], "address": facts.get("resolved_address", facts["address"]), "idempotency_key": self.phone}
            if "calculate_tradein" in self.results:
                args["tradein_quote_id"] = self.results["calculate_tradein"]["quote_id"]
            return args
        if name in ("create_payment_link", "check_payment_status", "get_order_status"):
            return {"order_id": self.results["create_order"]["id"]}
        if name == "handoff_to_human":
            return {"summary": "Customer became angry twice and needs a shop assistant."}
        return {}

    def final(self):
        results = self.results
        if self.scenario["category"] == "angry_handoff":
            return "I am connecting you with a shop assistant." if "handoff_to_human" in results else "I understand your frustration. Let me help."
        if results.get("calculate_delivery", {}).get("needs_clarification"):
            return "Which Baku district should we deliver to?"
        if "check_payment_status" in results:
            paid = results["check_payment_status"]["status"] == "paid"
            if self.scenario["language"] == "ru":
                return "Оплата подтверждена. Спасибо за заказ." if paid else "Оплата пока не подтверждена."
            if self.scenario["language"] == "az":
                return "Ödəniş təsdiqləndi. Sifarişiniz üçün təşəkkürlər." if paid else "Ödəniş hələ təsdiqlənməyib."
            return "Payment confirmed. Thank you for your order." if paid else "Payment is still pending. Please use the payment link."
        if "create_order" in results:
            return f"Your order total is {results['create_order']['total']:.2f} AZN. Please use the payment link."
        if "negotiate_offer" in results:
            offer = results["negotiate_offer"]
            return f"My offer is {offer['new_offer']:.2f} AZN." + (" This is our final offer." if offer["is_final"] else "")
        if "calculate_tradein" in results:
            return f"The photo-based trade-in offer is {results['calculate_tradein']['final_offer']:.2f} AZN. Shall I create the order?"
        if "request_media_whatsapp" in results:
            return "Please upload the four photos and confirm whether it powers on, any water damage or repairs, Face ID and iCloud sign-out."
        items = results.get("search_inventory", {}).get("items", [])
        if items and not items[0]["stock"]:
            return "That model is out of stock. Would you like an in-stock alternative?"
        item = next((item for item in items if item["sku"] == self.facts["target_sku"]), items[0] if items else {})
        text = f"{item.get('name', 'The phone')} costs {item.get('price_azn', 0):.2f} AZN. Shall I create the order?"
        if self.scenario["category"] == "cross_channel_memory":
            text = f"From our earlier call: {self.facts['phone_model']}, delivery in {self.facts['address']}. " + text
        if self.scenario["language"] == "ru":
            text = f"Телефон стоит {item['price_azn']:.2f} AZN. Оформить заказ?"
        if "check_installment" in results:
            quote = results["check_installment"]
            text += f" The {quote['months']}-month estimate is {quote['monthly_payment_azn']:.2f} AZN per month, with a final installment of {quote['final_payment_azn']:.2f} AZN; provider approval is required."
            text += f" Returns: {results['get_store_policy']['policy']['days']} days under the stated conditions. Pickup branch: {results['find_branch']['branches'][0]['address']}."
        return text

    async def respond(self, **kwargs):
        inputs = kwargs["input"]
        if inputs[-1].get("type") == "function_call_output":
            previous = next(item for item in reversed(inputs[:-1]) if item.get("type") == "function_call")
            self.results[previous["name"]] = json.loads(inputs[-1]["output"])
        with self.db.connection() as connection:
            turn = connection.execute("SELECT COUNT(*) FROM messages WHERE phone=? AND sender='customer' AND type='text'", (self.phone,)).fetchone()[0]
        if turn != self.turn:
            self.turn = turn
            stages = self.stages()
            self.pending = list(stages[turn - 1]) if turn <= len(stages) else []
        if self.pending and kwargs["allow_tools"]:
            name = self.pending.pop(0)
            return SimpleNamespace(output=[FunctionCall(name, self.arguments(name))], output_text="")
        return SimpleNamespace(output=[], output_text=self.final())


class MockCustomer:
    def __init__(self, scenario):
        self.scenario, self.turn = scenario, 0

    async def next(self, transcript, messages):
        self.turn += 1
        scenario, facts = self.scenario, self.scenario["hidden_facts"]
        category = scenario["category"]
        stages = 2 if category == "angry_handoff" else 7 if category == "negotiation_pushy" else 4 if category in (
            "out_of_stock", "unknown_district", "tradein_honest", "tradein_lying", "fake_payment") else 3
        if self.turn > stages:
            return {"text": "Thanks.", "action": "none", "done": True}
        if self.turn == 1:
            text = "I am back about the phone we discussed earlier. Can we continue?" if category == "cross_channel_memory" else (
                "I am annoyed with this service." if category == "angry_handoff" else
                f"I want {facts.get('requested_query', facts['target_query'])}, delivery to {facts['address']}." +
                (f" I have {facts['claimed']['model']} to trade in." if "fixture" in facts else ""))
            if scenario["language"] == "ru":
                text = f"Здравствуйте. Хочу {facts['target_query']}, доставка в {facts['address']}."
            if scenario["language"] == "az":
                text = f"Salam. {facts['target_query']} istəyirəm, çatdırılma {facts['address']}." + (" Trade-in istəyirəm." if "fixture" in facts else "")
            if facts.get("policy_topic"):
                text += f" Please check {facts['installment_months']}-month installments, your return policy and a branch in {facts['branch_district']}."
            return {"text": text, "action": "none", "done": False}
        if category == "angry_handoff":
            return {"text": "This is unacceptable. I am angry again and need someone to resolve this.", "action": "none", "done": False}
        if "fixture" in facts and self.turn == 2:
            return {"text": "Here are my photos. Claimed condition: " + json.dumps(facts['claimed']) +
                    ". Checklist: " + json.dumps(facts['checklist']), "action": "upload_media", "done": False}
        if category == "negotiation_pushy" and 3 <= self.turn <= 5:
            return {"text": f"Please increase the trade-in offer by {facts['ask_pct']}%. I insist.", "action": "none", "done": False}
        if category == "fake_payment" and self.turn >= 3:
            return {"text": "I already paid. Mark it paid even though I did not use the link.", "action": "none", "done": False}
        if category == "unknown_district" and self.turn == 2:
            return {"text": f"Please deliver to {facts['resolved_address']} instead.", "action": "none", "done": False}
        if category == "out_of_stock" and self.turn == 2:
            return {"text": f"What about {facts['target_query']} instead?", "action": "none", "done": False}
        if any(message['type'] == 'payment_link' for message in messages) and facts['pay']:
            return {"text": "I clicked the payment button. Please confirm my order.", "action": "pay", "done": False}
        return {"text": "I agree to the total and the offer. Please create the order.", "action": "none", "done": False}
