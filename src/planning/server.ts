import express from 'express';

const app = express();
const port = process.env.PORT || 3114;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'planning-engine', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Planning Engine server listening on port ${port}`);
});
