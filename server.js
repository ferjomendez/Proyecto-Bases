require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// Conexión MySQL (Aiven)
// =============================================
const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

// =============================================
// Conexión MongoDB (Atlas)
// =============================================
let mongoDb;
const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function connectMongo() {
  try {
    await mongoClient.connect();
    mongoDb = mongoClient.db('huella_carbono_logs');
    console.log('MongoDB Atlas conectado');
  } catch (err) {
    console.error('Error conectando MongoDB:', err.message);
  }
}

// =============================================
// Guardar consulta en MongoDB
// =============================================
async function logQuery(tipo, consulta, resultados, error = null) {
  if (!mongoDb) return;
  try {
    await mongoDb.collection('historial_consultas').insertOne({
      tipo,           // 'predefinida' o 'libre'
      consulta,       // el SQL ejecutado
      resultados: error ? null : resultados.length,
      error: error ? error.message : null,
      fecha: new Date(),
      usuario: 'web'
    });
  } catch (err) {
    console.error('Error guardando en MongoDB:', err.message);
  }
}

// =============================================
// Consultas predefinidas
// =============================================
const CONSULTAS_PREDEFINIDAS = {
  emisiones_por_empresa: {
    nombre: 'Emisiones totales por empresa',
    sql: `SELECT e.nombre AS empresa, s.nombre AS sector, p.nombre AS pais,
            COALESCE(SUM(ce.emision_total), 0) AS emisiones_totales_kg
          FROM empresa e
          JOIN sector s ON e.id_sector = s.id_sector
          JOIN pais p ON e.id_pais = p.id_pais
          LEFT JOIN consumo c ON e.id_empresa = c.id_empresa
          LEFT JOIN calculo_emision ce ON c.id_consumo = ce.id_consumo
          GROUP BY e.id_empresa, e.nombre, s.nombre, p.nombre
          ORDER BY emisiones_totales_kg DESC`
  },
  top_sectores: {
    nombre: 'Top sectores contaminantes',
    sql: `SELECT s.nombre AS sector, COUNT(DISTINCT e.id_empresa) AS num_empresas,
            COALESCE(SUM(ce.emision_total), 0) AS emisiones_totales_kg
          FROM sector s
          LEFT JOIN empresa e ON s.id_sector = e.id_sector
          LEFT JOIN consumo c ON e.id_empresa = c.id_empresa
          LEFT JOIN calculo_emision ce ON c.id_consumo = ce.id_consumo
          GROUP BY s.id_sector, s.nombre
          ORDER BY emisiones_totales_kg DESC`
  },
  emisiones_por_scope: {
    nombre: 'Emisiones por scope (1, 2, 3)',
    sql: `SELECT fe.scope,
            CASE fe.scope
              WHEN 1 THEN 'Directas'
              WHEN 2 THEN 'Indirectas energía'
              WHEN 3 THEN 'Otras indirectas'
            END AS tipo_scope,
            COALESCE(SUM(ce.emision_total), 0) AS emisiones_totales_kg
          FROM fuente_emision fe
          LEFT JOIN consumo c ON fe.id_fuente = c.id_fuente
          LEFT JOIN calculo_emision ce ON c.id_consumo = ce.id_consumo
          GROUP BY fe.scope
          ORDER BY fe.scope`
  },
  consumos_recientes: {
    nombre: 'Últimos 20 consumos registrados',
    sql: `SELECT e.nombre AS empresa, fe.nombre AS fuente, c.cantidad,
            fe.unidad, c.periodo, c.fecha_registro,
            COALESCE(ce.emision_total, 0) AS emision_kg
          FROM consumo c
          JOIN empresa e ON c.id_empresa = e.id_empresa
          JOIN fuente_emision fe ON c.id_fuente = fe.id_fuente
          LEFT JOIN calculo_emision ce ON c.id_consumo = ce.id_consumo
          ORDER BY c.fecha_registro DESC
          LIMIT 20`
  },
  empresas_por_pais: {
    nombre: 'Empresas por país',
    sql: `SELECT p.nombre AS pais, p.codigo_iso, COUNT(e.id_empresa) AS num_empresas
          FROM pais p
          LEFT JOIN empresa e ON p.id_pais = e.id_pais
          GROUP BY p.id_pais, p.nombre, p.codigo_iso
          ORDER BY num_empresas DESC`
  },
  fuentes_emision: {
    nombre: 'Catálogo de fuentes de emisión',
    sql: `SELECT nombre, factor_emision, unidad,
            CASE scope
              WHEN 1 THEN 'Scope 1 - Directas'
              WHEN 2 THEN 'Scope 2 - Indirectas energía'
              WHEN 3 THEN 'Scope 3 - Otras indirectas'
            END AS scope
          FROM fuente_emision
          ORDER BY scope, nombre`
  }
};

// =============================================
// API Routes
// =============================================

// Listar consultas predefinidas
app.get('/api/consultas', (req, res) => {
  const lista = Object.entries(CONSULTAS_PREDEFINIDAS).map(([key, val]) => ({
    id: key,
    nombre: val.nombre
  }));
  res.json(lista);
});

// Ejecutar consulta predefinida
app.get('/api/consultas/:id', async (req, res) => {
  const consulta = CONSULTAS_PREDEFINIDAS[req.params.id];
  if (!consulta) {
    return res.status(404).json({ error: 'Consulta no encontrada' });
  }
  try {
    const [rows] = await mysqlPool.execute(consulta.sql);
    await logQuery('predefinida', consulta.sql, rows);
    res.json({ nombre: consulta.nombre, sql: consulta.sql, datos: rows });
  } catch (err) {
    await logQuery('predefinida', consulta.sql, [], err);
    res.status(500).json({ error: err.message });
  }
});

// Ejecutar SQL libre (solo SELECT)
app.post('/api/sql', async (req, res) => {
  const { sql } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Debe enviar una consulta SQL' });
  }

  // Seguridad: solo permitir SELECT
  const sqlNormalizado = sql.trim().toUpperCase();
  if (!sqlNormalizado.startsWith('SELECT') && !sqlNormalizado.startsWith('SHOW') && !sqlNormalizado.startsWith('DESCRIBE')) {
    return res.status(403).json({ error: 'Solo se permiten consultas SELECT, SHOW y DESCRIBE' });
  }

  try {
    const [rows] = await mysqlPool.execute(sql);
    await logQuery('libre', sql, rows);
    res.json({ sql, datos: rows });
  } catch (err) {
    await logQuery('libre', sql, [], err);
    res.status(500).json({ error: err.message });
  }
});

// Obtener historial de consultas desde MongoDB
app.get('/api/historial', async (req, res) => {
  if (!mongoDb) {
    return res.status(503).json({ error: 'MongoDB no conectado' });
  }
  try {
    const historial = await mongoDb.collection('historial_consultas')
      .find({})
      .sort({ fecha: -1 })
      .limit(50)
      .toArray();
    res.json(historial);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Catálogos (para poblar dropdowns)
// =============================================
app.get('/api/sectores', async (req, res) => {
  try {
    const [rows] = await mysqlPool.execute('SELECT id_sector, nombre FROM sector ORDER BY nombre');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/paises', async (req, res) => {
  try {
    const [rows] = await mysqlPool.execute('SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/empresas', async (req, res) => {
  try {
    const [rows] = await mysqlPool.execute('SELECT id_empresa, nombre FROM empresa ORDER BY nombre');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/fuentes', async (req, res) => {
  try {
    const [rows] = await mysqlPool.execute(`SELECT id_fuente, nombre, factor_emision, unidad,
      CASE scope WHEN 1 THEN 'Scope 1' WHEN 2 THEN 'Scope 2' WHEN 3 THEN 'Scope 3' END AS scope
      FROM fuente_emision ORDER BY scope, nombre`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================
// Visualización con FILTRO por atributo (sector)
// Si no se envía id_sector, devuelve todas las empresas.
// =============================================
app.get('/api/emisiones-filtradas', async (req, res) => {
  const { id_sector } = req.query;
  let sql = `SELECT e.nombre AS empresa, s.nombre AS sector, p.nombre AS pais,
              e.tamano, COALESCE(SUM(ce.emision_total), 0) AS emisiones_totales_kg
            FROM empresa e
            JOIN sector s ON e.id_sector = s.id_sector
            JOIN pais p ON e.id_pais = p.id_pais
            LEFT JOIN consumo c ON e.id_empresa = c.id_empresa
            LEFT JOIN calculo_emision ce ON c.id_consumo = ce.id_consumo`;
  const params = [];
  if (id_sector) {
    sql += ' WHERE e.id_sector = ?';
    params.push(parseInt(id_sector));
  }
  sql += ` GROUP BY e.id_empresa, e.nombre, s.nombre, p.nombre, e.tamano
           ORDER BY emisiones_totales_kg DESC
           LIMIT 100`;
  try {
    const [rows] = await mysqlPool.execute(sql, params);
    await logQuery('predefinida', sql, rows);
    res.json({ nombre: 'Emisiones por empresa (filtrado por sector)', sql, datos: rows });
  } catch (err) {
    await logQuery('predefinida', sql, [], err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Registro de empresa
// =============================================
app.post('/api/empresas', async (req, res) => {
  const { nombre, tamano, id_sector, id_pais } = req.body;
  if (!nombre || !tamano || !id_sector || !id_pais) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  const tamanosValidos = ['micro', 'pequena', 'mediana', 'grande'];
  if (!tamanosValidos.includes(tamano)) {
    return res.status(400).json({ error: 'Tamaño inválido. Use: micro, pequena, mediana, grande' });
  }
  try {
    const sql = 'INSERT INTO empresa (nombre, tamano, id_sector, id_pais) VALUES (?, ?, ?, ?)';
    const [result] = await mysqlPool.execute(sql, [nombre, tamano, parseInt(id_sector), parseInt(id_pais)]);
    await logQuery('insercion', sql, [{ insertId: result.insertId }]);
    res.json({ mensaje: 'Empresa registrada', id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Registro de consumo + cálculo automático de emisión
// =============================================
app.post('/api/consumos', async (req, res) => {
  const { id_empresa, id_fuente, cantidad, periodo, fecha_registro } = req.body;
  if (!id_empresa || !id_fuente || !cantidad || !periodo || !fecha_registro) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  const periodosValidos = ['mensual', 'trimestral', 'anual'];
  if (!periodosValidos.includes(periodo)) {
    return res.status(400).json({ error: 'Periodo inválido. Use: mensual, trimestral, anual' });
  }

  const conn = await mysqlPool.getConnection();
  try {
    await conn.beginTransaction();

    // Obtener factor de emisión
    const [fuentes] = await conn.execute('SELECT factor_emision FROM fuente_emision WHERE id_fuente = ?', [parseInt(id_fuente)]);
    if (fuentes.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Fuente de emisión no encontrada' });
    }

    // Insertar consumo
    const sqlConsumo = 'INSERT INTO consumo (id_empresa, id_fuente, cantidad, periodo, fecha_registro) VALUES (?, ?, ?, ?, ?)';
    const [resultConsumo] = await conn.execute(sqlConsumo, [parseInt(id_empresa), parseInt(id_fuente), parseFloat(cantidad), periodo, fecha_registro]);

    // Calcular e insertar emisión
    const emisionTotal = parseFloat(cantidad) * parseFloat(fuentes[0].factor_emision);
    const sqlCalculo = 'INSERT INTO calculo_emision (id_consumo, emision_total) VALUES (?, ?)';
    await conn.execute(sqlCalculo, [resultConsumo.insertId, emisionTotal]);

    await conn.commit();
    await logQuery('insercion', `${sqlConsumo} + calculo_emision`, [{ insertId: resultConsumo.insertId, emisionTotal }]);

    res.json({
      mensaje: 'Consumo registrado y emisión calculada',
      id_consumo: resultConsumo.insertId,
      emision_total_kg: emisionTotal
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Estado de conexiones
app.get('/api/status', async (req, res) => {
  let mysqlOk = false;
  let mongoOk = false;

  try {
    await mysqlPool.execute('SELECT 1');
    mysqlOk = true;
  } catch (e) { /* */ }

  try {
    if (mongoDb) {
      await mongoDb.command({ ping: 1 });
      mongoOk = true;
    }
  } catch (e) { /* */ }

  res.json({ mysql: mysqlOk, mongodb: mongoOk });
});

// =============================================
// Iniciar servidor
// =============================================
const PORT = process.env.PORT || 3000;

connectMongo().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
});
