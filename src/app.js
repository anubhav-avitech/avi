require('dotenv').config();

const express = require('express');
const csrf = require('csurf');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const layouts = require('express-ejs-layouts');

const db = require('./config/db');
const routes = require('./routes');

const app = express();

/*
|--------------------------------------------------------------------------
| View Engine
|--------------------------------------------------------------------------
*/

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(layouts);

/*
|--------------------------------------------------------------------------
| Security & Performance
|--------------------------------------------------------------------------
*/

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(compression());

/*
|--------------------------------------------------------------------------
| Request Parsing
|--------------------------------------------------------------------------
*/

app.use(
  express.urlencoded({
    extended: false,
    limit: '20kb'
  })
);

/*
|--------------------------------------------------------------------------
| Static Files
|--------------------------------------------------------------------------
*/

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1d'
  })
);

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1d'
  })
);

/*
|--------------------------------------------------------------------------
| Session
|--------------------------------------------------------------------------
*/

const store = new MySQLStore({}, db);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    store,

    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

/*
|--------------------------------------------------------------------------
| CSRF Protection
|--------------------------------------------------------------------------
*/

app.use(csrf());

/*
|--------------------------------------------------------------------------
| Global EJS Variables
|--------------------------------------------------------------------------
|
| These variables are available in every EJS template.
|
*/

app.use((req, res, next) => {
  res.locals.appName =
    process.env.APP_NAME || 'Avitech Inventory';

  res.locals.title = 'Inventory';

  res.locals.csrfToken = req.csrfToken();

  res.locals.user = req.session.user || null;

  res.locals.path = req.path;

  res.locals.flash = req.session.flash || null;

  delete req.session.flash;

  next();
});

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/

app.use('/', routes);

/*
|--------------------------------------------------------------------------
| 404 Handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: 'Not found'
  });
});

/*
|--------------------------------------------------------------------------
| Error Handler
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('errors/403', {
      title: 'Invalid request'
    });
  }

  console.error(err);

  res.status(500).render('errors/500', {
    title: 'Server error'
  });
});

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(
    `Inventory system running on http://localhost:${port}`
  );
});