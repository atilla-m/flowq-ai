const LABELS: Record<string, [string, string]> = {
  get_customer_history: ['Loading customer memory…', 'Customer memory loaded'],
  search_inventory: ['Checking stock…', 'Stock checked'],
  request_media_whatsapp: ['Requesting photos…', 'Photos requested'],
  analyze_device_media: ['Analyzing photos…', 'Photos analyzed'],
  calculate_tradein: ['Calculating trade-in…', 'Trade-in calculated'],
  negotiate_offer: ['Checking offer…', 'Offer checked'],
  get_accessories: ['Finding accessories…', 'Accessories found'],
  calculate_delivery: ['Calculating delivery…', 'Delivery calculated'],
  create_order: ['Creating order…', 'Order created'],
  create_payment_link: ['Creating payment link…', 'Payment link sent'],
  check_payment_status: ['Checking payment…', 'Payment checked'],
  get_order_status: ['Checking order…', 'Order checked'],
  schedule_callback: ['Scheduling callback…', 'Callback scheduled'],
  handoff_to_human: ['Transferring to a person…', 'Transferred to a person'],
  check_installment: ['Checking installments…', 'Installments checked'],
  find_branch: ['Finding a branch…', 'Branch checked'],
}

export function toolLabel(name: string, pending?: boolean) {
  return LABELS[name]?.[pending ? 0 : 1] ?? name.replace(/_/g, ' ')
}
