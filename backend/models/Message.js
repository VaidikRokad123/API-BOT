import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
  },
  sender: {
    type: String,
    enum: ['user', 'gpt'],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'success',
  },
  error: {
    type: String,
    default: null,
  }
});

const Message = mongoose.model('Message', messageSchema);
export default Message;
