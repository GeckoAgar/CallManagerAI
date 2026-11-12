const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const contactRoutes = require('./routes/contactRoutes');
const callRoutes = require('./routes/callRoutes');
const recordingRoutes = require('./routes/recordingRoutes');
const reportRoutes = require('./routes/reportRoutes');
const roleRoutes = require('./routes/roleRoutes');
const supervisionRoutes = require('./routes/supervisionRoutes');
const softphoneRoutes = require('./routes/softphoneRoutes');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'CallManagerAI API', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/supervision', supervisionRoutes);
app.use('/api/softphone', softphoneRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'Ya existe un registro con esos datos.' });
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    return res.status(409).json({ message: 'No se puede eliminar este registro porque está relacionado con otros datos.' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ message: 'Una de las relaciones seleccionadas no existe.' });
  }
  return res.status(500).json({ message: 'Error interno del servidor.' });
});

module.exports = app;
