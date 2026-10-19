import { UnavailableAdapter } from './unavailable.ts'

export class SendgridAdapter extends UnavailableAdapter {
  constructor() { super('sendgrid', ['email']) }
}