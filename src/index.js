require('dotenv').config();
const express=require('express');
const cors=require('cors');
const authRoutes=require('./routes/auth');
const listingsRoutes=require('./routes/listings');
const bookingsRoutes=require('./routes/bookings');
const partnerAuthRoutes=require('./routes/partnerAuth');
const partnerBookingsRoutes=require('./routes/partnerBookings');
const adminPartnersRoutes=require('./routes/adminPartners');
const financeRoutes=require('./routes/finance');
const partnerFinanceRoutes=require('./routes/partnerFinance');
const {rateLimit}=require('./middleware/security');

const app=express();
const allowedOrigins=(process.env.CORS_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({origin(origin,cb){if(!origin||allowedOrigins.length===0||allowedOrigins.includes(origin))return cb(null,true);return cb(new Error('Origin non autorisée'));}}));
app.use(express.json({limit:'1mb'}));
app.use(rateLimit({windowMs:60_000,max:300}));
app.disable('x-powered-by');

app.get('/health',(req,res)=>res.json({status:'ok',service:'taama-api'}));
app.use('/auth',authRoutes);
app.use('/listings',listingsRoutes);
app.use('/bookings',bookingsRoutes);
app.use('/auth',partnerAuthRoutes);
app.use('/partner',partnerBookingsRoutes);
app.use('/admin',adminPartnersRoutes);
app.use('/admin/finance',financeRoutes);
app.use('/partner/finance',partnerFinanceRoutes);

app.use((err,req,res,next)=>{console.error('Unhandled error:',err.message);if(res.headersSent)return next(err);return res.status(500).json({error:'Erreur serveur'});});

const port=process.env.PORT||4000;
app.listen(port,()=>console.log(`Taama API démarrée sur le port ${port}`));
