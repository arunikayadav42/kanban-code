/** Port for sending notifications to the user. */
export interface NotifierPort {
  sendNotification(title: string, message: string, imageData: Buffer | null, cardId: string | null): Promise<void>;
  isConfigured(): boolean;
}
