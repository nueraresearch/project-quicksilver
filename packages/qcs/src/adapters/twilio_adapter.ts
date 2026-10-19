import { UnavailableAdapter } from './unavailable.ts'

export class TwilioAdapter extends UnavailableAdapter {
  constructor() { super('twilio', ['voice', 'sms']) }
}