"""One registry for Realtime, Responses and the HTTP tool endpoint."""
from copy import deepcopy


def obj(properties: dict, required=()) -> dict:
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


STRING = {"type": "string", "minLength": 1, "maxLength": 2000}
PHONE = {"type": "string", "description": "Optional current customer phone; normally injected by backend."}
NUMBER = {"type": "number", "minimum": 0, "maximum": 10000000}
DEVICE = obj({
    "analysis_id": STRING, "model": STRING,
    "storage": {"type": "integer", "minimum": 1, "maximum": 4096},
    "battery_health": {"type": "integer", "minimum": 0, "maximum": 100},
    **{key: {"type": "boolean"} for key in ("screen_cracked", "back_cracked", "powers_on", "water_damage",
       "repaired_before", "face_id_working", "face_id_broken", "icloud_signed_out", "does_not_power_on")},
})
CLAIMED = obj({"model": STRING, "storage": {"type": "integer", "minimum": 1},
               "battery_health": {"type": "integer", "minimum": 0, "maximum": 100},
               "screen_cracked": {"type": "boolean"}, "back_cracked": {"type": "boolean"},
               "damage": {"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}},
                           obj({"screen_cracked": {"type": "boolean"}, "back_cracked": {"type": "boolean"}})]}})


def tool(name: str, description: str, parameters: dict) -> dict:
    return {"type": "function", "name": name, "description": description, "parameters": parameters}


TOOLS = [
    tool("get_customer_history", "Get this customer's cross-channel memory, orders, uploads and latest trade-in quote.",
         obj({"phone": PHONE})),
    tool("search_inventory", "Find exact catalog SKUs, model, storage, color, authoritative price and stock. Pushes product cards in WhatsApp.",
         obj({"query": STRING}, ["query"])),
    tool("request_media_whatsapp", "Push clear trade-in photo instructions into WhatsApp, including DURING a voice call.",
         obj({"phone": PHONE, "what": {"type": "string", "maxLength": 2000}})),
    tool("analyze_device_media", "Verify all photos with vision. Empty media_ids uses recent uploads. Explicitly state mismatches; retake if needed.",
         obj({"phone": PHONE, "media_ids": {"type": "array", "items": STRING, "maxItems": 8}, "claimed": CLAIMED})),
    tool("calculate_tradein", "Deterministic price from verified photos and checklist. Supply analysis_id from vision. Photos override device claims. Ask missing checklist fields.",
         obj({"device_info": DEVICE}, ["device_info"])),
    tool("negotiate_offer", "Negotiate ONLY verified trade-in quotes. Supply quote_id. Backend current_offer wins. base_offer means condition-adjusted final_offer. Never exceeds +5%.",
         obj({"quote_id": STRING, "base_offer": NUMBER, "current_offer": NUMBER, "customer_ask": NUMBER}, ["customer_ask"])),
    tool("get_accessories", "Get only accessories compatible with the exact catalog phone model. Pushes matching-image product cards in WhatsApp.",
         obj({"phone_model": STRING}, ["phone_model"])),
    tool("calculate_delivery", "Get a district fee or zero for pickup; ask to clarify unknown or ambiguous locations.",
         obj({"address": STRING}, ["address"])),
    tool("create_order", "After customer agreement, reserve items and compute total from backend prices, verified quote and district. Never send a fabricated total. Pushes order_summary.",
         obj({"phone": PHONE, "items": {"type": "array", "minItems": 1, "maxItems": 12,
              "items": obj({"sku": STRING, "quantity": {"type": "integer", "minimum": 1, "maximum": 10}}, ["sku"])},
              "address": STRING, "tradein_quote_id": STRING,
              "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 100}}, ["items", "address"])),
    tool("create_payment_link", "Create pending mock payment and push payment_link to WhatsApp. This never marks paid.",
         obj({"order_id": STRING}, ["order_id"])),
    tool("check_payment_status", "Read payment from DB only. Saying I paid is not proof; only the payment endpoint changes status.",
         obj({"order_id": STRING}, ["order_id"])),
    tool("get_order_status", "Track this customer's order by order_id or list recent orders for the bound phone.",
         obj({"phone": PHONE, "order_id": STRING})),
    tool("schedule_callback", "Schedule an incoming_callback browser event, default 15 seconds, durable across restart.",
         obj({"phone": PHONE, "delay_seconds": {"type": "integer", "minimum": 0, "maximum": 3600}})),
    tool("handoff_to_human", "Create a human handoff event when angry twice, manager requested or request outside policy.",
         obj({"phone": PHONE, "summary": STRING}, ["summary"])),
]

SCHEMAS = {schema["name"]: schema for schema in TOOLS}


def realtime_tools() -> list[dict]:
    return deepcopy(TOOLS)


def response_tools() -> list[dict]:
    return [{**deepcopy(schema), "strict": False} for schema in TOOLS]
