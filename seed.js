// =============================================
// Script para crear tablas e insertar datos de ejemplo
// Ejecutar: npm run seed
// =============================================
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
    multipleStatements: true
  });

  console.log('Conectado a MySQL. Creando tablas e insertando datos...\n');

  // Crear tablas
  const createTables = `
    CREATE TABLE IF NOT EXISTS sector (
      id_sector   INT AUTO_INCREMENT,
      nombre      VARCHAR(100) NOT NULL,
      descripcion VARCHAR(255) NULL,
      PRIMARY KEY (id_sector)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS pais (
      id_pais     INT AUTO_INCREMENT,
      nombre      VARCHAR(100) NOT NULL,
      codigo_iso  CHAR(3) NOT NULL,
      PRIMARY KEY (id_pais),
      UNIQUE (codigo_iso)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS empresa (
      id_empresa  INT AUTO_INCREMENT,
      nombre      VARCHAR(150) NOT NULL,
      tamano      ENUM('micro', 'pequena', 'mediana', 'grande') NOT NULL,
      id_sector   INT NOT NULL,
      id_pais     INT NOT NULL,
      PRIMARY KEY (id_empresa),
      CONSTRAINT fk_empresa_sector FOREIGN KEY (id_sector) REFERENCES sector(id_sector) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_empresa_pais FOREIGN KEY (id_pais) REFERENCES pais(id_pais) ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS fuente_emision (
      id_fuente       INT AUTO_INCREMENT,
      nombre          VARCHAR(100) NOT NULL,
      factor_emision  DECIMAL(12,6) NOT NULL COMMENT 'kg CO2 eq por unidad',
      scope           TINYINT NOT NULL COMMENT '1=directas, 2=indirectas energia, 3=otras indirectas',
      unidad          VARCHAR(50) NOT NULL COMMENT 'Ej: kWh, litros, kg, km',
      PRIMARY KEY (id_fuente),
      CHECK (scope IN (1, 2, 3))
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS consumo (
      id_consumo      INT AUTO_INCREMENT,
      id_empresa      INT NOT NULL,
      id_fuente       INT NOT NULL,
      cantidad        DECIMAL(14,4) NOT NULL,
      periodo         ENUM('mensual', 'trimestral', 'anual') NOT NULL,
      fecha_registro  DATE NOT NULL,
      PRIMARY KEY (id_consumo),
      CONSTRAINT fk_consumo_empresa FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_consumo_fuente FOREIGN KEY (id_fuente) REFERENCES fuente_emision(id_fuente) ON UPDATE CASCADE ON DELETE RESTRICT,
      INDEX idx_consumo_empresa (id_empresa),
      INDEX idx_consumo_fecha (fecha_registro)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS calculo_emision (
      id_calculo      INT AUTO_INCREMENT,
      id_consumo      INT NOT NULL,
      emision_total   DECIMAL(14,6) NOT NULL COMMENT 'En kg CO2 equivalente',
      fecha_calculo   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_calculo),
      CONSTRAINT fk_calculo_consumo FOREIGN KEY (id_consumo) REFERENCES consumo(id_consumo) ON UPDATE CASCADE ON DELETE CASCADE,
      UNIQUE (id_consumo)
    ) ENGINE=InnoDB;
  `;

  await connection.query(createTables);
  console.log('Tablas creadas.\n');

  // Verificar si ya hay datos
  const [rows] = await connection.query('SELECT COUNT(*) AS c FROM sector');
  if (rows[0].c > 0) {
    console.log('Ya existen datos. Omitiendo insercion de datos semilla.');
    await connection.end();
    return;
  }

  // Insertar datos
  const insertData = `
    -- Sectores
    INSERT INTO sector (nombre, descripcion) VALUES
      ('Energia', 'Generacion y distribucion de energia electrica'),
      ('Transporte', 'Transporte terrestre, aereo y maritimo'),
      ('Manufactura', 'Industria manufacturera y produccion'),
      ('Agricultura', 'Actividades agricolas y ganaderas'),
      ('Construccion', 'Construccion e infraestructura'),
      ('Mineria', 'Extraccion de minerales y recursos');

    -- Paises
    INSERT INTO pais (nombre, codigo_iso) VALUES
      ('Chile', 'CHL'),
      ('Argentina', 'ARG'),
      ('Brasil', 'BRA'),
      ('Colombia', 'COL'),
      ('Mexico', 'MEX'),
      ('Peru', 'PER');

    -- Empresas
    INSERT INTO empresa (nombre, tamano, id_sector, id_pais) VALUES
      ('EnergiaSolar Chile', 'grande', 1, 1),
      ('TransporteVerde SA', 'mediana', 2, 1),
      ('MineraAndina', 'grande', 6, 1),
      ('AgroSustentable', 'pequena', 4, 1),
      ('ConstruccionEco', 'mediana', 5, 2),
      ('ManufacturaBA', 'grande', 3, 2),
      ('PetroBrasil', 'grande', 1, 3),
      ('LogisticaMX', 'mediana', 2, 5),
      ('CafeColumbia', 'pequena', 4, 4),
      ('MineraPeru', 'grande', 6, 6);

    -- Fuentes de emision
    INSERT INTO fuente_emision (nombre, factor_emision, scope, unidad) VALUES
      ('Diesel (vehiculos)', 2.680000, 1, 'litros'),
      ('Gas natural', 2.020000, 1, 'metros cubicos'),
      ('Gasolina', 2.310000, 1, 'litros'),
      ('Electricidad (red Chile)', 0.390000, 2, 'kWh'),
      ('Electricidad (red Argentina)', 0.350000, 2, 'kWh'),
      ('Electricidad (red Brasil)', 0.080000, 2, 'kWh'),
      ('Vuelos domesticos', 0.255000, 3, 'km-pasajero'),
      ('Transporte carga terrestre', 0.105000, 3, 'ton-km'),
      ('Residuos solidos', 0.450000, 1, 'kg'),
      ('Agua potable', 0.344000, 3, 'metros cubicos');

    -- Consumos (datos de ejemplo para 2025)
    INSERT INTO consumo (id_empresa, id_fuente, cantidad, periodo, fecha_registro) VALUES
      (1, 4, 150000.0000, 'mensual', '2025-01-15'),
      (1, 2, 5000.0000, 'mensual', '2025-01-15'),
      (1, 4, 145000.0000, 'mensual', '2025-02-15'),
      (2, 1, 12000.0000, 'mensual', '2025-01-20'),
      (2, 3, 8000.0000, 'mensual', '2025-01-20'),
      (2, 7, 25000.0000, 'trimestral', '2025-03-31'),
      (3, 1, 50000.0000, 'mensual', '2025-01-10'),
      (3, 4, 800000.0000, 'mensual', '2025-01-10'),
      (3, 9, 15000.0000, 'mensual', '2025-01-10'),
      (4, 1, 2000.0000, 'mensual', '2025-02-01'),
      (4, 10, 500.0000, 'mensual', '2025-02-01'),
      (5, 5, 50000.0000, 'mensual', '2025-01-15'),
      (5, 2, 3000.0000, 'mensual', '2025-01-15'),
      (6, 5, 200000.0000, 'mensual', '2025-01-20'),
      (6, 1, 15000.0000, 'mensual', '2025-01-20'),
      (7, 6, 500000.0000, 'mensual', '2025-02-10'),
      (7, 2, 80000.0000, 'mensual', '2025-02-10'),
      (8, 1, 30000.0000, 'mensual', '2025-01-25'),
      (8, 8, 100000.0000, 'trimestral', '2025-03-31'),
      (9, 1, 1500.0000, 'mensual', '2025-02-05'),
      (9, 10, 200.0000, 'mensual', '2025-02-05'),
      (10, 1, 80000.0000, 'mensual', '2025-01-15'),
      (10, 4, 1200000.0000, 'mensual', '2025-01-15'),
      (10, 9, 30000.0000, 'mensual', '2025-01-15');

    -- Calculos de emision (cantidad * factor_emision)
    INSERT INTO calculo_emision (id_consumo, emision_total) VALUES
      (1, 150000 * 0.39),
      (2, 5000 * 2.02),
      (3, 145000 * 0.39),
      (4, 12000 * 2.68),
      (5, 8000 * 2.31),
      (6, 25000 * 0.255),
      (7, 50000 * 2.68),
      (8, 800000 * 0.39),
      (9, 15000 * 0.45),
      (10, 2000 * 2.68),
      (11, 500 * 0.344),
      (12, 50000 * 0.35),
      (13, 3000 * 2.02),
      (14, 200000 * 0.35),
      (15, 15000 * 2.68),
      (16, 500000 * 0.08),
      (17, 80000 * 2.02),
      (18, 30000 * 2.68),
      (19, 100000 * 0.105),
      (20, 1500 * 2.68),
      (21, 200 * 0.344),
      (22, 80000 * 2.68),
      (23, 1200000 * 0.39),
      (24, 30000 * 0.45);
  `;

  await connection.query(insertData);
  console.log('Datos semilla insertados:');
  console.log('  - 6 sectores');
  console.log('  - 6 paises');
  console.log('  - 10 empresas');
  console.log('  - 10 fuentes de emision');
  console.log('  - 24 consumos');
  console.log('  - 24 calculos de emision');
  console.log('\nSeed completado!');

  await connection.end();
}

seed().catch(err => {
  console.error('Error en seed:', err.message);
  process.exit(1);
});
