const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../services/auth.service');
const inventory = require('../services/inventory.service');
const masters = require('../services/master.service');
const purchaseOrders = require('../services/purchase-order.service');
const users = require('../services/user.service');
const employeeDirectory = require('../services/employee.service');
const { dashboard } = require('../services/dashboard.service');
const activity = require('../services/activity.service');
const { audit } = require('../services/audit.service');
const { requireAuth, requirePermission, requireAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/security');

const setFlash = (req, msg, type = 'success') => {
  req.session.flash = { msg, type };
};
const masterType = type => ['chemicals', 'vendors', 'glassware', 'equipment'].includes(type) ? type : null;
const orderFormItems = data => {
  const list = value => Array.isArray(value) ? value : value === undefined ? [] : [value];
  const names = list(data.product_name);
  const productSizes = list(data.product_size || data.description);
  const quantities = list(data.quantity);
  const units = list(data.unit);
  const rates = list(data.rate);
  const count = Math.max(names.length, productSizes.length, quantities.length, units.length, rates.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    product_name: names[index] || '',
    product_size: productSizes[index] || '',
    quantity: quantities[index] || '',
    unit: units[index] || '',
    rate: rates[index] || ''
  }));
};

router.get('/purchase-orders', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    let rows = [];
    let filterErrors = {};
    try {
      rows = await purchaseOrders.list(req.query);
    } catch (error) {
      if (error.message !== 'INVALID_PURCHASE_ORDER_FILTER') throw error;
      filterErrors = error.fields;
    }
    res.render('purchase-orders/index', {
      title: 'Purchase orders',
      rows,
      query: req.query.q || '',
      from: req.query.from || '',
      to: req.query.to || '',
      filterErrors
    });
  } catch (error) {
    next(error);
  }
});

router.get('/purchase-orders/new', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.render('purchase-orders/form', {
      title: 'New purchase order',
      action: '/purchase-orders/new',
      vendors: await masters.list('vendors'),
      chemicals: await masters.list('chemicals'),
      record: { order_date: new Date().toISOString().slice(0, 10), payment_mode: '', advance_percent: '' },
      items: orderFormItems({}),
      errors: {},
      formError: null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/purchase-orders/new', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = await purchaseOrders.create(req.body, req.session.user);
    setFlash(req, 'Purchase order created.');
    res.redirect(`/purchase-orders/${id}`);
  } catch (error) {
    if (error.message === 'INVALID_PURCHASE_ORDER' || error.message === 'INVALID_VENDOR') {
      return res.status(422).render('purchase-orders/form', {
        title: 'New purchase order',
        action: '/purchase-orders/new',
        vendors: await masters.list('vendors'),
        chemicals: await masters.list('chemicals'),
        record: req.body,
        items: orderFormItems(req.body),
        errors: error.fields || {},
        formError: error.message === 'INVALID_VENDOR' ? 'Select an existing vendor from Vendor Master.' : null
      });
    }
    next(error);
  }
});

router.get('/purchase-orders/company-settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.render('purchase-orders/company-settings', {
      title: 'Purchase order company details',
      settings: await purchaseOrders.companySettings(),
      errors: {},
      formError: null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/purchase-orders/company-settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await purchaseOrders.updateCompanySettings(req.body);
    setFlash(req, 'Purchase order company details saved.');
    res.redirect('/purchase-orders/company-settings');
  } catch (error) {
    if (error.message === 'INVALID_COMPANY_SETTINGS') {
      return res.status(422).render('purchase-orders/company-settings', {
        title: 'Purchase order company details',
        settings: req.body,
        errors: error.fields,
        formError: null
      });
    }
    next(error);
  }
});

router.get('/purchase-orders/:id/edit', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const record = await purchaseOrders.get(req.params.id);
    if (!record) return res.status(404).render('errors/404', { title: 'Not found' });
    res.render('purchase-orders/form', {
      title: `Edit ${record.po_number}`,
      action: `/purchase-orders/${record.id}/edit`,
      vendors: await masters.list('vendors'),
      chemicals: await masters.list('chemicals'),
      record: {
        ...record,
        payment_mode: record.advance_percent === null || record.advance_percent === undefined || record.advance_percent === ''
          ? ''
          : Number(record.advance_percent) === 0 ? '0' : Number(record.advance_percent) === 50 ? '50' : Number(record.advance_percent) === 100 ? '100' : 'custom',
        advance_percent: record.advance_percent === null || record.advance_percent === undefined || record.advance_percent === '' ? '' : Number(record.advance_percent)
      },
      items: record.items,
      errors: {},
      formError: null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/purchase-orders/:id/edit', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await purchaseOrders.update(req.params.id, req.body, req.session.user);
    setFlash(req, 'Purchase order updated.');
    res.redirect(`/purchase-orders/${req.params.id}`);
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).render('errors/404', { title: 'Not found' });
    if (error.message === 'INVALID_PURCHASE_ORDER' || error.message === 'INVALID_VENDOR') {
      return res.status(422).render('purchase-orders/form', {
        title: 'Edit purchase order',
        action: `/purchase-orders/${req.params.id}/edit`,
        vendors: await masters.list('vendors'),
        chemicals: await masters.list('chemicals'),
        record: req.body,
        items: orderFormItems(req.body),
        errors: error.fields || {},
        formError: error.message === 'INVALID_VENDOR' ? 'Select an existing vendor from Vendor Master.' : null
      });
    }
    next(error);
  }
});

router.post('/purchase-orders/:id/delete', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await purchaseOrders.remove(req.params.id, req.session.user);
    setFlash(req, 'Purchase order deleted.');
    res.redirect('/purchase-orders');
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).render('errors/404', { title: 'Not found' });
    next(error);
  }
});

router.get('/purchase-orders/:id/print', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const order = await purchaseOrders.get(req.params.id);
    if (!order) return res.status(404).render('errors/404', { title: 'Not found' });
    res.render('purchase-orders/print', { layout: false, title: order.po_number, order });
  } catch (error) {
    next(error);
  }
});

router.get('/purchase-orders/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const order = await purchaseOrders.get(req.params.id);
    if (!order) return res.status(404).render('errors/404', { title: 'Not found' });
    res.render('purchase-orders/show', {
      title: order.po_number,
      order,
      history: await purchaseOrders.history(req.params.id)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/master/:type', requireAuth, requireAdmin, async (req, res, next) => {
  const type = masterType(req.params.type);
  if (!type) return res.status(404).render('errors/404', { title: 'Not found' });
  try {
    const config = masters.configFor(type);
    const pageData = await masters.listPage(type, req.query);
    res.render('masters/index', {
      title: `${config.label} master`,
      type,
      config,
      ...pageData
    });
  } catch (error) {
    next(error);
  }
});

router.get('/master/:type/new', requireAuth, requireAdmin, (req, res) => {
  const type = masterType(req.params.type);
  if (!type) return res.status(404).render('errors/404', { title: 'Not found' });
  const config = masters.configFor(type);
  res.render('masters/form', {
    title: `Add ${config.label.toLowerCase()}`,
    type,
    config,
    fields: masters.fields(type),
    record: {},
    errors: {},
    action: `/master/${type}/new`
  });
});

router.post('/master/:type/new', requireAuth, requireAdmin, async (req, res, next) => {
  const type = masterType(req.params.type);
  if (!type) return res.status(404).render('errors/404', { title: 'Not found' });
  const config = masters.configFor(type);
  try {
    await masters.create(type, req.body, req.session.user);
    setFlash(req, `${config.label} added.`);
    res.redirect(`/master/${type}`);
  } catch (error) {
    if (error.message === 'INVALID_MASTER_DATA' || error.code === 'ER_DUP_ENTRY') {
      return res.status(422).render('masters/form', {
        title: `Add ${config.label.toLowerCase()}`,
        type,
        config,
        fields: masters.fields(type),
        record: req.body,
        errors: error.fields || {},
        formError: error.code === 'ER_DUP_ENTRY' ? `${config.label} already exists.` : null,
        action: `/master/${type}/new`
      });
    }
    if (error.message === 'NOT_FOUND') return res.status(404).render('errors/404', { title: 'Not found' });
    next(error);
  }
});

router.get('/master/:type/:id/edit', requireAuth, requireAdmin, async (req, res, next) => {
  const type = masterType(req.params.type);
  if (!type) return res.status(404).render('errors/404', { title: 'Not found' });
  try {
    const config = masters.configFor(type);
    const record = await masters.get(type, req.params.id);
    if (!record) return res.status(404).render('errors/404', { title: 'Not found' });
    res.render('masters/form', {
      title: `Edit ${config.label.toLowerCase()}`,
      type,
      config,
      fields: masters.fields(type),
      record,
      errors: {},
      action: `/master/${type}/${record.id}/edit`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/master/:type/:id/edit', requireAuth, requireAdmin, async (req, res, next) => {
  const type = masterType(req.params.type);
  if (!type) return res.status(404).render('errors/404', { title: 'Not found' });
  const config = masters.configFor(type);
  try {
    const record = await masters.get(type, req.params.id);
    if (!record) return res.status(404).render('errors/404', { title: 'Not found' });
    await masters.update(type, req.params.id, req.body, req.session.user);
    setFlash(req, `${config.label} updated.`);
    res.redirect(`/master/${type}`);
  } catch (error) {
    if (error.message === 'INVALID_MASTER_DATA' || error.code === 'ER_DUP_ENTRY') {
      return res.status(422).render('masters/form', {
        title: `Edit ${config.label.toLowerCase()}`,
        type,
        config,
        fields: masters.fields(type),
        record: { ...req.body, id: req.params.id },
        errors: error.fields || {},
        formError: error.code === 'ER_DUP_ENTRY' ? `${config.label} already exists.` : null,
        action: `/master/${type}/${req.params.id}/edit`
      });
    }
    if (error.message === 'NOT_FOUND') return res.status(404).render('errors/404', { title: 'Not found' });
    next(error);
  }
});

router.post('/master/:type/:id/delete', requireAuth, requireAdmin, async (req, res, next) => {
  const type = masterType(req.params.type);
  if (!type) return res.status(404).render('errors/404', { title: 'Not found' });
  const config = masters.configFor(type);
  try {
    await masters.remove(type, req.params.id, req.session.user);
    setFlash(req, `${config.label} deleted.`);
  } catch (error) {
    if (error.message === 'MASTER_IN_USE' || error.code === 'ER_ROW_IS_REFERENCED_2') {
      setFlash(req, `This ${config.label.toLowerCase()} cannot be deleted because it is referenced by inventory records.`, 'error');
    } else if (error.message !== 'NOT_FOUND') {
      return next(error);
    } else {
      setFlash(req, `${config.label} was not found.`, 'error');
    }
  }
  res.redirect(`/master/${type}`);
});

router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Sign in', error: null });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(req.body.password || '');
    const user = await auth.login(email, password);

    if (!user) {
      await audit(null, 'FAILED_LOGIN', 'authentication', null, { username: email }, req.ip);
      return res.status(401).render('auth/login', {
        title: 'Sign in',
        error: 'Invalid email or password.'
      });
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role_name: user.role_name,
        permissions: user.permissions
      };
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        audit(user.id, 'USER_LOGIN', 'system', null, null, req.ip)
          .then(() => res.redirect('/'))
          .catch(error => {
            req.session.destroy(() => next(error));
          });
      });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await audit(req.session.user.id, 'USER_LOGOUT', 'system', null, null, req.ip);
    req.session.destroy(error => {
      if (error) return next(error);
      res.redirect('/login');
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, requirePermission('DASHBOARD_VIEW'), async (req, res, next) => {
  try {
    res.render('dashboard/index', {
      title: 'Dashboard',
      data: await dashboard(req.session.user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/inventory', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    const items = await inventory.list(req.session.user, req.query.q);
    res.render('inventory/index', {
      title: 'Inventory',
      items,
      query: req.query.q || ''
    });
  } catch (error) {
    next(error);
  }
});

router.get('/inventory/batches', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    res.render('inventory/batches', {
      title: 'Batch receiving records',
      batches: await inventory.batchReceivingRecords()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/inventory/batches/receiving-record', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    const record = await inventory.batchReceivingRecord(
      req.query.batch_number
    );
    if (!record) return res.status(404).render('errors/404', { title: 'Not found' });
    res.render('inventory/receiving-record', {
      title: `Batch ${record.batch_number} receiving record`,
      record,
      preparedBy: req.session.user.name
    });
  } catch (error) {
    if (error.message === 'INVALID_BATCH') {
      return res.status(404).render('errors/404', { title: 'Not found' });
    }
    if (error.message === 'FORBIDDEN') {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    next(error);
  }
});

router.get('/inventory/new', requireAuth, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    res.render('inventory/form', {
      title: 'Add inventory',
      item: null,
      batches: await inventory.chemicalBatches(),
      chemicals: await masters.list('chemicals'),
      vendors: await masters.list('vendors'),
      glassware: await masters.active('glassware'),
      equipment: await masters.active('equipment'),
      action: '/inventory/new'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/inventory/new', requireAuth, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    await inventory.create(req.body, req.session.user);
    setFlash(req, 'Inventory item created.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Asset code or serial number already exists.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'FORBIDDEN') {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    if (error.message === 'INVALID_QUANTITY') {
      setFlash(req, 'Quantity must be greater than zero.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_CHEMICAL_MASTER') {
      setFlash(req, 'Select a registered chemical from the suggestions.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_ITEM_MASTER') {
      setFlash(req, 'Select one registered glassware or equipment master record.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_GLASSWARE_DETAILS') {
      setFlash(req, 'Enter the glassware type, capacity, unit, material, class and graduation.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_EQUIPMENT_DETAILS') {
      setFlash(req, 'Enter a valid equipment type and calibration or warranty details.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_VENDOR_MASTER') {
      setFlash(req, 'Select a registered vendor from the suggestions.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_MINIMUM_STOCK' || error.message === 'INVALID_ITEM_NAME') {
      setFlash(req, 'Enter a valid product name and non-negative minimum stock threshold.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_CHEMICAL') {
      setFlash(req, 'Enter a batch number, expiry date, valid container capacity and matching unit.', 'error');
      return res.redirect('/inventory/new');
    }
    next(error);
  }
});

router.get('/inventory/:id/restock', requireAuth, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    const item = await inventory.get(req.params.id);
    if (!item) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    res.render('inventory/restock', {
      title: 'Add stock',
      item,
      action: `/inventory/${item.id}/restock`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/inventory/:id/restock', requireAuth, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    await inventory.restock(req.params.id, req.body.quantity, req.session.user);
    setFlash(req, 'Stock quantity added.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.message === 'INVALID_QUANTITY') {
      setFlash(req, 'Enter a valid quantity. Chemical stock must be entered as whole containers.', 'error');
      return res.redirect(`/inventory/${req.params.id}/restock`);
    }
    if (error.message === 'STOCK_LIMIT') {
      setFlash(req, 'Stock quantity exceeds the maximum supported amount.', 'error');
      return res.redirect(`/inventory/${req.params.id}/restock`);
    }
    if (error.message === 'RETIRED_ITEM') {
      setFlash(req, 'Retired stock cannot be increased.', 'error');
      return res.redirect('/inventory');
    }
    if (error.message === 'STOCK_NOT_AVAILABLE') {
      setFlash(req, 'Stock cannot be increased while the item is in maintenance, lost or damaged status.', 'error');
      return res.redirect('/inventory');
    }
    if (error.message === 'FORBIDDEN') {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    next(error);
  }
});

router.post('/inventory/:id/adjust', requireAuth, requirePermission('INVENTORY_UPDATE'), async (req, res, next) => {
  try {
    await inventory.adjustStock(req.params.id, req.body.delta, req.body.note, req.session.user);
    setFlash(req, 'Stock adjustment recorded.');
    res.redirect(`/inventory/${req.params.id}/edit`);
  } catch (error) {
    const messages = {
      INSUFFICIENT: 'Adjustment cannot reduce central stock below zero.',
      STOCK_LIMIT: 'Adjustment exceeds the maximum supported stock quantity.',
      INVALID_QUANTITY: 'Enter a non-zero valid adjustment. Chemical quantities must be whole containers.',
      INVALID_REMARKS: 'Enter a reason of 500 characters or fewer.',
      NOT_FOUND: 'Inventory item not found.',
      RETIRED_ITEM: 'Retired stock cannot be adjusted.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    next(error);
  }
});

router.post('/inventory/:id/dispose', requireAuth, requirePermission('INVENTORY_UPDATE'), async (req, res, next) => {
  try {
    await inventory.disposeStock(req.params.id, req.body.quantity, req.body.note, req.session.user);
    setFlash(req, 'Stock disposal recorded.');
    res.redirect(`/inventory/${req.params.id}/edit`);
  } catch (error) {
    const messages = {
      INSUFFICIENT: 'Disposal quantity exceeds central stock.',
      INVALID_QUANTITY: 'Enter a valid disposal quantity.',
      INVALID_REMARKS: 'Enter a reason of 500 characters or fewer.',
      NOT_FOUND: 'Inventory item not found.',
      RETIRED_ITEM: 'Retired stock cannot be disposed.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    next(error);
  }
});

router.get('/inventory/:id/edit', requireAuth, requirePermission('INVENTORY_UPDATE'), async (req, res, next) => {
  try {
    const item = await inventory.get(req.params.id);
    if (!item) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }

    res.render('inventory/form', {
      title: 'Edit inventory',
      item,
      batches: [],
      chemicals: await masters.list('chemicals'),
      vendors: await masters.list('vendors'),
      action: `/inventory/${item.id}/edit`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/inventory/:id/edit', requireAuth, requirePermission('INVENTORY_UPDATE'), async (req, res, next) => {
  try {
    await inventory.update(req.params.id, req.body, req.session.user);
    setFlash(req, 'Inventory updated.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.message === 'FORBIDDEN') return res.status(403).render('errors/403', { title: 'Access denied' });
    if (error.message === 'RETIRED_ITEM') {
      setFlash(req, 'Retired inventory cannot be edited.', 'error');
      return res.redirect('/inventory');
    }
    if (error.message === 'INVALID_CHEMICAL') {
      setFlash(req, 'Enter a valid batch number, expiry date, container capacity and matching unit.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'INVALID_CHEMICAL_MASTER') {
      setFlash(req, 'Select a registered chemical from the suggestions.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'INVALID_VENDOR_MASTER') {
      setFlash(req, 'Select a registered vendor from the suggestions.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'INVALID_GLASSWARE_DETAILS') {
      setFlash(req, 'Enter the glassware type, capacity, unit, material, class and graduation.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'INVALID_EQUIPMENT_DETAILS') {
      setFlash(req, 'Enter a valid equipment type and calibration or warranty details.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'CHEMICAL_TYPE_IMMUTABLE') {
      setFlash(req, 'An inventory record cannot be changed between chemical and non-chemical stock.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'ITEM_TYPE_IMMUTABLE') {
      setFlash(req, 'Inventory type cannot be changed after stock has been assigned.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'ITEM_UNIT_IMMUTABLE') {
      setFlash(req, 'Stock unit cannot be changed after an inventory record is created.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'CHEMICAL_STOCK_METADATA_LOCKED') {
      setFlash(req, 'Chemical name, batch, expiry and container details cannot be changed after stock has been issued. Add a new stock line for a different batch or size.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'INVALID_MINIMUM_STOCK' || error.message === 'INVALID_ITEM_NAME') {
      setFlash(req, 'Enter a valid product name and non-negative minimum stock threshold.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Asset code or serial number already exists.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    next(error);
  }
});

router.post('/inventory/:id/retire', requireAuth, requirePermission('INVENTORY_DELETE'), async (req, res, next) => {
  try {
    await inventory.retire(req.params.id, req.session.user);
    setFlash(req, 'Inventory retired.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.message === 'FORBIDDEN') return res.status(403).render('errors/403', { title: 'Access denied' });
    if (error.message === 'RETURN_ACTIVE_ASSIGNMENTS') {
      setFlash(req, 'Return active assignments before retiring this item.', 'error');
      return res.redirect('/inventory');
    }
    next(error);
  }
});

router.get('/inventory/:id/history', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    const item = await inventory.get(req.params.id);
    if (!item) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }

    if (req.session.user.role_name !== 'Administrator' || !req.session.user.permissions.includes('AUDIT_VIEW')) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    res.redirect(`/activity-history?q=${encodeURIComponent(item.asset_code || item.name)}`);
  } catch (error) {
    next(error);
  }
});

router.get('/activity-history', requireAuth, requireAdmin, requirePermission('AUDIT_VIEW'), async (req, res, next) => {
  try {
    const data = await activity.list(req.query);
    res.render('dashboard/activity', { title: 'Activity & History', ...data });
  } catch (error) {
    next(error);
  }
});

router.get('/history', requireAuth, requireAdmin, requirePermission('AUDIT_VIEW'), (req, res) => {
  res.redirect('/activity-history');
});

router.get('/assignments', requireAuth, async (req, res, next) => {
  try {
    if (!['Administrator', 'Inventory User'].includes(req.session.user.role_name) ||
        (!req.session.user.permissions.includes('ASSIGNMENT_CREATE') &&
         !req.session.user.permissions.includes('ASSIGNMENT_RETURN') &&
         !req.session.user.permissions.includes('ASSIGNMENT_CONSUME'))) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    res.render('assignments/index', {
      title: 'Assignments',
      rows: await inventory.assignments(req.session.user, req.query.employee_id)
    });
  } catch (error) {
    if (error.message === 'INVALID_EMPLOYEE') {
      setFlash(req, 'Select a valid employee filter.', 'error');
      return res.redirect('/assignments');
    }
    next(error);
  }
});

router.get('/employees/new', requireAuth, requirePermission('ASSIGNMENT_CREATE'), (req, res) => {
  res.render('employees/form', { title: 'Add employee' });
});

router.post('/employees/new', requireAuth, requirePermission('ASSIGNMENT_CREATE'), async (req, res, next) => {
  try {
    await employeeDirectory.create(req.body, req.session.user);
    setFlash(req, 'Employee added. You can assign inventory now.');
    res.redirect('/assignments/new');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'That employee ID is already in use.', 'error');
      return res.redirect('/employees/new');
    }
    if (error.message === 'EMPLOYEE_FIELDS_REQUIRED') {
      setFlash(req, 'Enter an employee ID and name.', 'error');
      return res.redirect('/employees/new');
    }
    next(error);
  }
});

router.get('/assignments/new', requireAuth, requirePermission('ASSIGNMENT_CREATE'), async (req, res, next) => {
  try {
    const items = await inventory.list(req.session.user);
    res.render('assignments/form', {
      title: 'Assign inventory',
      items: items.filter(item => item.status === 'AVAILABLE' && !item.expired && Number(item.quantity) > 0),
      employees: await employeeDirectory.listActive(),
      action: '/assignments/new'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/assignments/new', requireAuth, requirePermission('ASSIGNMENT_CREATE'), async (req, res, next) => {
  try {
    await inventory.assign(req.body.inventory_id, req.body.employee_id, req.body.quantity, req.body.remarks, req.session.user);
    setFlash(req, 'Inventory assigned successfully.');
    res.redirect('/assignments');
  } catch (error) {
    const messages = {
      FORBIDDEN: 'You cannot access this inventory.',
      INVALID_EMPLOYEE: 'Selected employee is not active.',
      INSUFFICIENT: 'Not enough available quantity.',
      NOT_FOUND: 'Inventory item not found.',
      INVALID_QUANTITY: 'Enter a valid quantity. Chemical stock must be issued as whole containers.',
      INVALID_REMARKS: 'Remarks must be 500 characters or fewer.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect('/assignments/new');
    }
    next(error);
  }
});

router.post('/assignments/:id/consume', requireAuth, requirePermission('ASSIGNMENT_CONSUME'), async (req, res, next) => {
  try {
    await inventory.consumeAssignment(req.params.id, req.body.quantity, req.body.note, req.session.user);
    setFlash(req, 'Consumption recorded.');
    res.redirect('/assignments');
  } catch (error) {
    const messages = {
      INVALID_CONSUMPTION: 'Consumption cannot exceed the employee’s remaining balance.',
      INVALID_QUANTITY: 'Enter a valid quantity.',
      INVALID_REMARKS: 'Remarks must be 500 characters or fewer.',
      NOT_CONSUMABLE: 'Only consumables can be recorded as consumed.',
      NOT_FOUND: 'Assignment not found.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect('/assignments');
    }
    next(error);
  }
});

router.post('/assignments/:id/return', requireAuth, requirePermission('ASSIGNMENT_RETURN'), async (req, res, next) => {
  try {
    await inventory.returnAssignment(req.params.id, req.body.quantity, req.body.note, req.session.user);
    setFlash(req, 'Return recorded.');
    res.redirect('/assignments');
  } catch (error) {
    const messages = {
      FORBIDDEN: 'You cannot access this assignment.',
      INVALID_RETURN: 'Return quantity is invalid.',
      INVALID_QUANTITY: 'Quantity must be greater than zero.',
      STOCK_LIMIT: 'The return would exceed the maximum supported central stock quantity.',
      NOT_RETURNABLE: 'Only assigned equipment/assets can be returned.',
      INVALID_REMARKS: 'Remarks must be 500 characters or fewer.',
      NOT_FOUND: 'Assignment is no longer active.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect('/assignments');
    }
    next(error);
  }
});

// User and audit administration remain administrator-only.
router.get('/users', requireAuth, requireAdmin, requirePermission('USERS_VIEW'), async (req, res, next) => {
  try {
    res.render('users/index', { title: 'Inventory Team', rows: await users.list(req.session.user) });
  } catch (error) {
    next(error);
  }
});

router.get('/users/new', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    res.render('users/form', { title: 'Add user', person: null });
  } catch (error) {
    next(error);
  }
});

router.post('/users/new', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    await users.create(req.body, req.session.user);
    setFlash(req, 'User created.');
    res.redirect('/users');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Employee code or email already exists.', 'error');
      return res.redirect('/users/new');
    }
    if (error.message === 'INVENTORY_ROLE_UNAVAILABLE') {
      setFlash(req, 'The employee role is not configured. Contact the administrator.', 'error');
      return res.redirect('/users/new');
    }
    next(error);
  }
});

router.get('/users/:id/edit', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT u.*,r.name AS role_name
      FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.id=?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).render('errors/404', { title: 'Not found' });
    res.render('users/form', { title: 'Edit user', person: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/edit', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    await users.update(req.params.id, req.body, req.session.user);
    setFlash(req, 'User updated.');
    res.redirect('/users');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Employee code or email already exists.', 'error');
      return res.redirect(`/users/${req.params.id}/edit`);
    }
    next(error);
  }
});

router.post('/users/:id/delete', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    await users.remove(req.params.id, req.session.user);
    setFlash(req, 'User permanently deleted. Existing activity history has been kept without linking it to the deleted account.');
    res.redirect('/users');
  } catch (error) {
    const messages = {
      NOT_FOUND: 'User not found.',
      CANNOT_DELETE_SELF: 'You cannot delete your own account.',
      LAST_ACTIVE_ADMIN: 'The last active administrator cannot be deleted.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect('/users');
    }
    next(error);
  }
});

router.get('/audit', requireAuth, requireAdmin, requirePermission('AUDIT_VIEW'), (req, res) => {
  res.redirect('/activity-history');
});

module.exports = router;
