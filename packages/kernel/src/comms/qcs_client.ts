export interface QcsPort<Request extends { from_agent_id: string }, Result, Context, Event> {
  sendMessage(request: Request, context: Context): Promise<Result>
  subscribeToEvents(handler: (event: Event) => Promise<void>, context: Context): Promise<() => void>
}

export class KernelQcsClient<Request extends { from_agent_id: string }, Result, Context, Event> {
  private readonly port: QcsPort<Request, Result, Context, Event>

  constructor(port: QcsPort<Request, Result, Context, Event>) {
    this.port = port
  }

  kernelSendMessage(agentId: string, request: Omit<Request, 'from_agent_id'>, context: Context): Promise<Result> {
    return this.port.sendMessage({ ...request, from_agent_id: agentId } as Request, context)
  }

  kernelSubscribeToQcsEvents(handler: (event: Event) => Promise<void>, context: Context): Promise<() => void> {
    return this.port.subscribeToEvents(handler, context)
  }
}