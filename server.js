require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;

// Configuración Supabase (solo para base de datos)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Variable para controlar inicialización de DB
let dbInitialized = false;

// Crear directorio para imágenes si no existe
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log('Directorio uploads creado:', UPLOADS_DIR);
}

// Función para guardar imagen localmente
function saveImageLocally(base64Data, equipoId, imageIndex) {
    try {
        if (!base64Data || !base64Data.includes(',')) {
            console.error('Datos base64 inválidos');
            return null;
        }
        
        const matches = base64Data.match(/^data:image\/([a-zA-Z]*);base64,(.*)$/);
        if (!matches || matches.length !== 3) {
            throw new Error('Formato base64 inválido');
        }
        
        const imageType = matches[1];
        const imageData = matches[2];
        const buffer = Buffer.from(imageData, 'base64');
        
        // Crear directorio para el equipo si no existe (sin espacios)
        const safeEquipoId = equipoId.replace(/[^a-zA-Z0-9]/g, '');
        const equipoDir = path.join(UPLOADS_DIR, safeEquipoId);
        if (!fs.existsSync(equipoDir)) {
            fs.mkdirSync(equipoDir, { recursive: true });
        }
        
        const timestamp = Date.now();
        const fileName = `${timestamp}-${imageIndex}.${imageType}`;
        const relativeFilePath = `${safeEquipoId}/${fileName}`;
        const fullFilePath = path.join(UPLOADS_DIR, relativeFilePath);
        
        // Guardar archivo
        fs.writeFileSync(fullFilePath, buffer);
        
        console.log(`Imagen guardada localmente: ${relativeFilePath}`);
        
        return {
            filename: relativeFilePath,
            url: `/uploads/${relativeFilePath}`,
            size: buffer.length
        };
        
    } catch (error) {
        console.error('Error guardando imagen localmente:', error);
        return null;
    }
}

// Función para eliminar imagen local
function deleteImageLocally(filename) {
    try {
        // Solo eliminar si no es URL de Supabase
        if (filename.startsWith('http')) {
            console.log(`Imagen de Supabase, no eliminar localmente: ${filename}`);
            return true;
        }
        
        const fullPath = path.join(UPLOADS_DIR, filename);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(`Imagen local eliminada: ${filename}`);
            return true;
        }
        console.log(`Imagen local no encontrada: ${filename}`);
        return false;
    } catch (error) {
        console.error('Error eliminando imagen:', error);
        return false;
    }
}

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir imágenes estáticamente
app.use('/uploads', (req, res, next) => {
    console.log(`Petición de archivo: ${req.method} ${req.url}`);
    console.log(`Ruta completa solicitada: ${req.path}`);
    
    const filePath = path.join(UPLOADS_DIR, req.path);
    
    if (!fs.existsSync(filePath)) {
        console.error(`Archivo no encontrado: ${filePath}`);
        return res.status(404).json({
            error: 'Archivo no encontrado',
            path: req.path,
            fullPath: filePath
        });
    }
    
    console.log(`Archivo encontrado: ${filePath}`);
    next();
}, express.static(UPLOADS_DIR, {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res, path, stat) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        
        const ext = path.toLowerCase().split('.').pop();
        switch (ext) {
            case 'jpg':
            case 'jpeg':
                res.set('Content-Type', 'image/jpeg');
                break;
            case 'png':
                res.set('Content-Type', 'image/png');
                break;
            case 'gif':
                res.set('Content-Type', 'image/gif');
                break;
            case 'webp':
                res.set('Content-Type', 'image/webp');
                break;
            default:
                res.set('Content-Type', 'application/octet-stream');
        }
        
        console.log(`Sirviendo: ${path} (${stat.size} bytes)`);
    }
}));

// Inicializar Supabase (solo base de datos)
async function initializeSupabase() {
    try {
        console.log('Inicializando Supabase (solo base de datos)...');
        
        const { data, error } = await supabase.from('computadores').select('count', { count: 'exact' });
        
        if (error && error.code === '42P01') {
            console.log('TABLA NO EXISTE - Ejecuta este SQL en Supabase:');
            console.log(`
CREATE TABLE IF NOT EXISTS computadores (
    id SERIAL PRIMARY KEY,
    equipo_id VARCHAR(100) UNIQUE NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    placa_ml VARCHAR(100),
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    direccion_automatica TEXT,
    ubicacion_manual TEXT,
    responsable VARCHAR(200) NOT NULL,
    cargo VARCHAR(100) NOT NULL,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('operativo', 'mantenimiento', 'dañado')),
    windows_update VARCHAR(5) NOT NULL CHECK (windows_update IN ('si', 'no')),
    imagenes JSONB DEFAULT '[]'::jsonb,
    observaciones TEXT,
    problemas_detectados TEXT,
    fecha_revision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revisor VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_serial_number ON computadores(serial_number);
CREATE INDEX IF NOT EXISTS idx_equipo_id ON computadores(equipo_id);
CREATE INDEX IF NOT EXISTS idx_estado ON computadores(estado);
CREATE INDEX IF NOT EXISTS idx_fecha_revision ON computadores(fecha_revision);

ALTER TABLE computadores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo acceso" ON computadores FOR ALL USING (true);
ALTER TABLE computadores REPLICA IDENTITY FULL;
            `);
            throw new Error('Tabla no existe - ejecuta el SQL mostrado arriba');
        } else if (error) {
            throw error;
        }
        
        console.log('Supabase (base de datos) conectado exitosamente');
        console.log('Almacenamiento: HIBRIDO - Supabase Storage + Local');
        dbInitialized = true;
        
    } catch (error) {
        console.error('Error al inicializar Supabase:', error);
        throw error;
    }
}

// FUNCIÓN MIDDLEWARE - MOVIDA AQUÍ ARRIBA
function checkDatabase(req, res, next) {
    if (!dbInitialized) {
        return res.status(500).json({
            error: 'Base de datos no disponible',
            details: 'Supabase no se ha inicializado correctamente'
        });
    }
    next();
}

// FUNCIÓN DE MANEJO DE ERRORES - MOVIDA AQUÍ ARRIBA
function handleSupabaseError(error, res, operation = 'operación') {
    console.error(`Error en ${operation}:`, error);
    
    let statusCode = 500;
    let message = 'Error interno del servidor';
    let details = error.message;
    
    if (error.code === '23505') {
        statusCode = 400;
        message = 'El ID del equipo ya existe';
        details = 'El identificador del equipo debe ser único';
    } else if (error.code === '23514') {
        statusCode = 400;
        message = 'Valor no válido';
        details = 'El valor proporcionado no cumple con las restricciones';
    } else if (error.code === '23502') {
        statusCode = 400;
        message = 'Campo requerido faltante';
    }
    
    res.status(statusCode).json({
        error: message,
        details: details,
        code: error.code || 'SUPABASE_ERROR'
    });
}

// 🔧 ENDPOINT PARA CORREGIR IMÁGENES - AHORA EN LA POSICIÓN CORRECTA
app.post('/api/fix-imagenes', checkDatabase, async (req, res) => {
    try {
        console.log('🔧 Iniciando corrección de URLs de imágenes...');
        
        // Obtener todos los computadores con imágenes
        const { data: computadores, error } = await supabase
            .from('computadores')
            .select('*')
            .not('imagenes', 'is', null);
            
        if (error) throw error;
        
        let actualizados = 0;
        let totalImagenes = 0;
        
        for (const computador of computadores) {
            if (computador.imagenes && Array.isArray(computador.imagenes)) {
                let necesitaActualizacion = false;
                
                // Corregir URLs de cada imagen
                const imagenesCorregidas = computador.imagenes.map(imagen => {
                    totalImagenes++;
                    
                    if (imagen.filename && imagen.url && imagen.url.includes('/uploads/')) {
                        // URL antigua de Koyeb - corregir a Supabase
                        const nuevaURL = supabase.storage
                            .from('imagenes-soporte')
                            .getPublicUrl(imagen.filename).data.publicUrl;
                            
                        necesitaActualizacion = true;
                        
                        return {
                            ...imagen,
                            url: nuevaURL,
                            url_anterior: imagen.url, // Guardar referencia
                            corregida_el: new Date().toISOString()
                        };
                    }
                    return imagen;
                });
                
                // Actualizar solo si es necesario
                if (necesitaActualizacion) {
                    const { error: updateError } = await supabase
                        .from('computadores')
                        .update({ imagenes: imagenesCorregidas })
                        .eq('id', computador.id);
                        
                    if (!updateError) {
                        actualizados++;
                        console.log(`✅ URLs corregidas para ${computador.equipo_id}: ${imagenesCorregidas.length} imágenes`);
                    } else {
                        console.error(`❌ Error actualizando ${computador.equipo_id}:`, updateError);
                    }
                }
            }
        }
        
        console.log(`🎉 RECUPERACIÓN COMPLETADA: ${actualizados} equipos con URLs corregidas`);
        console.log(`📊 Total de imágenes procesadas: ${totalImagenes}`);
        
        res.json({
            success: true,
            message: 'URLs de imágenes corregidas exitosamente',
            equipos_actualizados: actualizados,
            total_imagenes_procesadas: totalImagenes,
            accion: 'Las imágenes ahora deberían ser accesibles desde Supabase Storage',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error ejecutando corrección:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error corrigiendo URLs',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ENDPOINT PARA VERIFICAR STATUS DE IMÁGENES
app.get('/api/imagenes-status', checkDatabase, async (req, res) => {
    try {
        const { data: computadores, error } = await supabase
            .from('computadores')
            .select('id, equipo_id, imagenes')
            .not('imagenes', 'is', null);
            
        if (error) throw error;
        
        let totalEquipos = computadores.length;
        let totalImagenes = 0;
        let imagenesSupabase = 0;
        let imagenesLocales = 0;
        let imagenesBrotas = 0;
        
        const analisis = computadores.map(comp => {
            const imagenes = comp.imagenes || [];
            totalImagenes += imagenes.length;
            
            const imagenesInfo = imagenes.map(img => {
                if (img.url && img.url.includes('supabase.co')) {
                    imagenesSupabase++;
                    return { ...img, tipo: 'supabase', estado: 'ok' };
                } else if (img.url && img.url.includes('/uploads/')) {
                    imagenesBrotas++;
                    return { ...img, tipo: 'koyeb_rota', estado: 'rota' };
                } else {
                    imagenesLocales++;
                    return { ...img, tipo: 'local', estado: 'ok' };
                }
            });
            
            return {
                id: comp.id,
                equipo_id: comp.equipo_id,
                cantidad_imagenes: imagenes.length,
                imagenes: imagenesInfo
            };
        });
        
        res.json({
            resumen: {
                total_equipos: totalEquipos,
                total_imagenes: totalImagenes,
                imagenes_supabase: imagenesSupabase,
                imagenes_locales: imagenesLocales,
                imagenes_rotas: imagenesBrotas
            },
            necesita_fix: imagenesBrotas > 0,
            analisis_completo: analisis
        });
        
    } catch (error) {
        console.error('Error obteniendo status:', error);
        res.status(500).json({ error: 'Error obteniendo estado de imágenes' });
    }
});

// FUNCIÓN AUXILIAR PARA CORRECCIÓN (ya no se usa directamente pero la mantenemos)
async function corregirURLsImagenes() {
    try {
        console.log('🔧 Corrigiendo URLs de imágenes de Supabase Storage...');
        
        // Obtener todos los computadores con imágenes
        const { data: computadores, error } = await supabase
            .from('computadores')
            .select('*')
            .not('imagenes', 'is', null);
            
        if (error) throw error;
        
        let actualizados = 0;
        
        for (const computador of computadores) {
            if (computador.imagenes && Array.isArray(computador.imagenes)) {
                let necesitaActualizacion = false;
                
                // Corregir URLs de cada imagen
                const imagenesCorregidas = computador.imagenes.map(imagen => {
                    if (imagen.filename && imagen.url && imagen.url.includes('/uploads/')) {
                        // URL antigua de Koyeb - corregir a Supabase
                        const nuevaURL = supabase.storage
                            .from('imagenes-soporte')
                            .getPublicUrl(imagen.filename).data.publicUrl;
                            
                        necesitaActualizacion = true;
                        
                        return {
                            ...imagen,
                            url: nuevaURL,
                            url_anterior: imagen.url, // Guardar referencia
                            corregida_el: new Date().toISOString()
                        };
                    }
                    return imagen;
                });
                
                // Actualizar solo si es necesario
                if (necesitaActualizacion) {
                    const { error: updateError } = await supabase
                        .from('computadores')
                        .update({ imagenes: imagenesCorregidas })
                        .eq('id', computador.id);
                        
                    if (!updateError) {
                        actualizados++;
                        console.log(`✅ URLs corregidas para ${computador.equipo_id}: ${imagenesCorregidas.length} imágenes`);
                    }
                }
            }
        }
        
        console.log(`🎉 RECUPERACIÓN COMPLETADA: ${actualizados} equipos con URLs corregidas`);
        return actualizados;
        
    } catch (error) {
        console.error('❌ Error corrigiendo URLs:', error);
        return 0;
    }
}

// HEALTH CHECK
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        storage: 'hybrid',
        uploadsDir: UPLOADS_DIR,
        uptime: process.uptime(),
        mode: 'supabase_storage + local_storage'
    };
    
    try {
        const { data, error } = await supabase.from('computadores').select('count', { count: 'exact' });
        if (!error) {
            health.database = 'connected';
        }
        
        health.uploadsExists = fs.existsSync(UPLOADS_DIR);
        health.uploadsWritable = true;
        
        try {
            const testFile = path.join(UPLOADS_DIR, 'test.txt');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
        } catch (e) {
            health.uploadsWritable = false;
        }
        
        health.status = dbInitialized && health.uploadsWritable ? 'ok' : 'error';
    } catch (err) {
        health.status = 'error';
        health.error = err.message;
        return res.status(500).json(health);
    }
    
    res.json(health);
});

// OBTENER COMPUTADORES - CORREGIDO para manejar Supabase Storage + Local
app.get('/api/computadores', checkDatabase, async (req, res) => {
    try {
        console.log('Obteniendo lista de computadores...');
        const { estado, responsable, equipo_id, serial_number, revisor } = req.query;
        
        let query = supabase.from('computadores').select('*');
        
        if (estado) query = query.eq('estado', estado);
        if (responsable) query = query.ilike('responsable', `%${responsable}%`);
        if (equipo_id) query = query.ilike('equipo_id', `%${equipo_id}%`);
        if (serial_number) query = query.ilike('serial_number', `%${serial_number}%`);
        if (revisor) query = query.ilike('revisor', `%${revisor}%`);
        
        query = query.order('fecha_revision', { ascending: false });
        
        const { data, error } = await query;
        if (error) throw error;
        
        // CORREGIDO: Procesar imágenes para compatibilidad híbrida
        const computadoresConImagenes = data.map(computador => {
            if (computador.imagenes && Array.isArray(computador.imagenes)) {
                const imagenesProc = computador.imagenes.map(imagen => {
                    // Si la imagen tiene URL de Supabase Storage, pasarla como filename
                    if (imagen.url && imagen.url.includes('supabase.co')) {
                        return {
                            ...imagen,
                            filename: imagen.url  // Pasar URL completa como filename
                        };
                    }
                    
                    // Para imágenes locales, verificar que existan
                    if (imagen.filename && !imagen.filename.startsWith('http')) {
                        const fullPath = path.join(UPLOADS_DIR, imagen.filename);
                        if (fs.existsSync(fullPath)) {
                            return imagen;
                        } else {
                            console.log(`Imagen local no encontrada: ${imagen.filename}`);
                            return null;
                        }
                    }
                    
                    return imagen;
                }).filter(img => img !== null);
                
                return {
                    ...computador,
                    imagenes: imagenesProc
                };
            }
            return computador;
        });
        
        console.log(`Se encontraron ${computadoresConImagenes.length} computadores`);
        res.json(computadoresConImagenes);
        
    } catch (error) {
        handleSupabaseError(error, res, 'obtener computadores');
    }
});

// CREAR NUEVO COMPUTADOR
app.post('/api/computadores', checkDatabase, async (req, res) => {
    try {
        console.log('Creando nuevo registro...');
        
        const {
            equipo_id, serial_number, placa_ml, latitud, longitud,
            direccion_automatica, ubicacion_manual, responsable, cargo,
            estado, windows_update, observaciones, problemas_detectados,
            revisor, imagenes
        } = req.body;
        
        if (!equipo_id || !serial_number || !responsable || !cargo || !estado || !windows_update) {
            return res.status(400).json({
                error: 'Campos requeridos faltantes',
                required: ['equipo_id', 'serial_number', 'responsable', 'cargo', 'estado', 'windows_update']
            });
        }
        
        // Procesar imágenes localmente (nuevas imágenes se guardan en local)
        let imagenesGuardadas = [];
        if (imagenes && Array.isArray(imagenes)) {
            console.log(`Procesando ${imagenes.length} imágenes localmente...`);
            
            for (let i = 0; i < imagenes.length; i++) {
                const imagen = imagenes[i];
                if (imagen.base64) {
                    const resultado = saveImageLocally(imagen.base64, equipo_id, i + 1);
                    
                    if (resultado) {
                        imagenesGuardadas.push({
                            title: imagen.title || `Imagen ${i + 1}`,
                            filename: resultado.filename,
                            url: resultado.url,
                            size: resultado.size,
                            fecha_subida: new Date().toISOString()
                        });
                        console.log(`Imagen ${i + 1} guardada: ${resultado.filename}`);
                    }
                }
            }
        }
        
        const { data, error } = await supabase
            .from('computadores')
            .insert([{
                equipo_id, serial_number, placa_ml, latitud, longitud,
                direccion_automatica, ubicacion_manual, responsable, cargo,
                estado, windows_update,
                imagenes: imagenesGuardadas,
                observaciones, problemas_detectados, revisor
            }])
            .select()
            .single();
            
        if (error) throw error;
        
        console.log(`Registro creado con ID: ${data.id} y ${imagenesGuardadas.length} imágenes locales`);
        
        res.status(201).json({
            id: data.id,
            equipo_id: data.equipo_id,
            serial_number: data.serial_number,
            imagenes_guardadas: imagenesGuardadas.length,
            message: 'Registro creado exitosamente con almacenamiento local'
        });
        
    } catch (error) {
        handleSupabaseError(error, res, 'crear registro');
    }
});

// ACTUALIZAR COMPUTADOR
app.put('/api/computadores/:id', checkDatabase, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Actualizando registro ID: ${id}`);
        
        const {
            equipo_id, serial_number, placa_ml, latitud, longitud,
            direccion_automatica, ubicacion_manual, responsable, cargo,
            estado, windows_update, observaciones, problemas_detectados,
            revisor, imagenes
        } = req.body;
        
        // Procesar imágenes (nuevas y existentes)
        let imagenesFinales = [];
        if (imagenes && Array.isArray(imagenes)) {
            console.log(`Procesando ${imagenes.length} imágenes...`);
            
            for (let i = 0; i < imagenes.length; i++) {
                const imagen = imagenes[i];
                
                if (imagen.base64 && imagen.base64.startsWith('data:image')) {
                    // Nueva imagen - guardar localmente
                    const resultado = saveImageLocally(imagen.base64, `${equipo_id}-update`, i + 1);
                    
                    if (resultado) {
                        imagenesFinales.push({
                            title: imagen.title || `Imagen ${i + 1}`,
                            filename: resultado.filename,
                            url: resultado.url,
                            size: resultado.size,
                            fecha_subida: new Date().toISOString()
                        });
                    }
                } else if (imagen.filename) {
                    // Imagen existente - puede ser Supabase Storage o local
                    if (imagen.filename.startsWith('http')) {
                        // URL de Supabase Storage - mantener tal como está
                        imagenesFinales.push({
                            title: imagen.title || `Imagen ${i + 1}`,
                            filename: imagen.filename,  // URL completa
                            url: imagen.filename,       // URL completa
                            size: imagen.size || 0,
                            fecha_subida: imagen.fecha_subida || new Date().toISOString()
                        });
                    } else {
                        // Imagen local - verificar que existe
                        const fullPath = path.join(UPLOADS_DIR, imagen.filename);
                        if (fs.existsSync(fullPath)) {
                            imagenesFinales.push({
                                title: imagen.title || `Imagen ${i + 1}`,
                                filename: imagen.filename,
                                url: imagen.url,
                                size: imagen.size || 0,
                                fecha_subida: imagen.fecha_subida || new Date().toISOString()
                            });
                        }
                    }
                }
            }
        }
        
        const { data, error } = await supabase
            .from('computadores')
            .update({
                equipo_id, serial_number, placa_ml, latitud, longitud,
                direccion_automatica, ubicacion_manual, responsable, cargo,
                estado, windows_update,
                imagenes: imagenesFinales,
                observaciones, problemas_detectados, revisor,
                fecha_actualizacion: new Date().toISOString()
            })
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Registro no encontrado' });
        }
        
        console.log(`Registro ID ${id} actualizado con ${imagenesFinales.length} imágenes`);
        
        res.json({
            message: 'Registro actualizado exitosamente',
            imagenes_guardadas: imagenesFinales.length
        });
        
    } catch (error) {
        handleSupabaseError(error, res, 'actualizar registro');
    }
});

// ELIMINAR COMPUTADOR
app.delete('/api/computadores/:id', checkDatabase, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Eliminando registro ID: ${id}`);
        
        const { data: computador } = await supabase
            .from('computadores')
            .select('imagenes')
            .eq('id', id)
            .single();
        
        const { data, error } = await supabase
            .from('computadores')
            .delete()
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Registro no encontrado' });
        }
        
        // Eliminar solo imágenes locales (no las de Supabase Storage)
        if (computador && computador.imagenes && Array.isArray(computador.imagenes)) {
            for (const imagen of computador.imagenes) {
                if (imagen.filename) {
                    deleteImageLocally(imagen.filename);
                }
            }
        }
        
        console.log(`Registro ID ${id} eliminado exitosamente`);
        
        res.json({ 
            message: 'Registro eliminado exitosamente'
        });
        
    } catch (error) {
        handleSupabaseError(error, res, 'eliminar registro');
    }
});

// ESTADÍSTICAS
app.get('/api/estadisticas', checkDatabase, async (req, res) => {
    try {
        console.log('Generando estadísticas...');
        
        const { data: computadores, error } = await supabase
            .from('computadores')
            .select('estado, windows_update, imagenes, problemas_detectados, latitud, longitud, fecha_revision');
            
        if (error) throw error;
        
        const total = computadores.length;
        const operativos = computadores.filter(c => c.estado === 'operativo').length;
        const mantenimiento = computadores.filter(c => c.estado === 'mantenimiento').length;
        const dañados = computadores.filter(c => c.estado === 'dañado').length;
        const windowsSi = computadores.filter(c => c.windows_update === 'si').length;
        const windowsNo = computadores.filter(c => c.windows_update === 'no').length;
        
        const hoy = new Date().toDateString();
        const revisionesHoy = computadores.filter(c => 
            new Date(c.fecha_revision).toDateString() === hoy
        ).length;
        
        const conProblemas = computadores.filter(c => 
            c.problemas_detectados && c.problemas_detectados.trim() !== ''
        ).length;
        
        const conUbicacion = computadores.filter(c => 
            c.latitud && c.longitud
        ).length;
        
        const conImagenes = computadores.filter(c => 
            c.imagenes && Array.isArray(c.imagenes) && c.imagenes.length > 0
        ).length;
        
        const totalImagenes = computadores.reduce((sum, c) => 
            sum + (c.imagenes && Array.isArray(c.imagenes) ? c.imagenes.length : 0), 0
        );
        
        const stats = {
            total,
            operativos,
            mantenimiento,
            dañados,
            windows_si: windowsSi,
            windows_no: windowsNo,
            revisiones_hoy: revisionesHoy,
            con_problemas: conProblemas,
            con_ubicacion: conUbicacion,
            con_imagenes: conImagenes,
            total_imagenes: totalImagenes,
            totalEquipos: total,
            windowsActualizados: windowsSi
        };
        
        console.log('Estadísticas generadas:', stats);
        res.json(stats);
        
    } catch (error) {
        handleSupabaseError(error, res, 'obtener estadísticas');
    }
});

// EXPORTAR PARA EXCEL
app.get('/api/export/excel', checkDatabase, async (req, res) => {
    try {
        console.log('Exportando datos para Excel...');
        
        const { data: computadores, error } = await supabase
            .from('computadores')
            .select('*')
            .order('fecha_revision', { ascending: false });
            
        if (error) throw error;
        
        const excelData = computadores.map(row => {
            const imagenesInfo = row.imagenes && Array.isArray(row.imagenes) ? 
                row.imagenes.map(img => img.title).join('; ') : 'Sin imágenes';
            
            return {
                'ID EQUIPO': row.equipo_id,
                'SERIAL': row.serial_number,
                'PLACA/ML': row.placa_ml || 'NO ASIGNADO',
                'RESPONSABLE': row.responsable,
                'CARGO': row.cargo,
                'ESTADO': row.estado.toUpperCase(),
                'WINDOWS UPDATE': row.windows_update === 'si' ? 'SÍ' : 'NO',
                'UBICACIÓN': row.direccion_automatica || row.ubicacion_manual || 'NO ESPECIFICADA',
                'PROBLEMAS': row.problemas_detectados || 'NINGUNO',
                'OBSERVACIONES': row.observaciones || 'SIN OBSERVACIONES',
                'REVISOR': row.revisor || 'NO ESPECIFICADO',
                'FECHA REVISIÓN': new Date(row.fecha_revision).toLocaleDateString('es-ES'),
                'HORA REVISIÓN': new Date(row.fecha_revision).toLocaleTimeString('es-ES'),
                'CANTIDAD IMÁGENES': row.imagenes ? row.imagenes.length : 0,
                'DESCRIPCIÓN IMÁGENES': imagenesInfo
            };
        });
        
        console.log(`Datos preparados para exportar: ${excelData.length} registros`);
        res.json(excelData);
        
    } catch (error) {
        handleSupabaseError(error, res, 'exportar datos');
    }
});

// RUTA PRINCIPAL
app.get('/', (req, res) => {
    res.json({
        message: 'API de soporte técnico con almacenamiento híbrido funcionando',
        features: [
            'Base de datos: Supabase PostgreSQL',
            'Almacenamiento: Híbrido (Supabase Storage + Local)',
            'Imágenes existentes: Supabase Storage',
            'Imágenes nuevas: Servidor local'
        ],
        endpoints: {
            health: '/api/health',
            computadores: '/api/computadores',
            estadisticas: '/api/estadisticas',
            export: '/api/export/excel',
            uploads: '/uploads',
            fix_imagenes: '/api/fix-imagenes',
            imagenes_status: '/api/imagenes-status'
        },
        storage: {
            type: 'hybrid',
            directory: UPLOADS_DIR,
            url: '/uploads'
        }
    });
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({
        error: 'Error interno del servidor',
        details: err.message,
        timestamp: new Date().toISOString(),
        service: 'hybrid_storage'
    });
});

// Manejar rutas no encontradas
app.use('*', (req, res) => {
    console.log(`Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: [
            'GET /api/health',
            'GET /api/computadores',
            'POST /api/computadores',
            'PUT /api/computadores/:id',
            'DELETE /api/computadores/:id',
            'GET /api/estadisticas',
            'POST /api/fix-imagenes',
            'GET /api/imagenes-status',
            'GET /uploads/:filename'
        ]
    });
});

// Iniciar servidor
async function startServer() {
    try {
        console.log('Iniciando servidor con almacenamiento híbrido...');
        
        await initializeSupabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('Servidor iniciado exitosamente');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`Servidor: http://localhost:${PORT}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('CONFIGURACIÓN:');
            console.log('   Base de datos: Supabase PostgreSQL');
            console.log('   Almacenamiento: HÍBRIDO');
            console.log('   - Imágenes existentes: Supabase Storage');
            console.log('   - Imágenes nuevas: Servidor local');
            console.log(`   Directorio local: ${UPLOADS_DIR}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('ENDPOINTS DISPONIBLES:');
            console.log('   POST /api/fix-imagenes - Corregir URLs');
            console.log('   GET /api/imagenes-status - Status de imágenes');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });
        
    } catch (error) {
        console.error('Error fatal al iniciar servidor:', error);
        process.exit(1);
    }
}

// Manejo de cierre graceful
process.on('SIGINT', async () => {
    console.log('\nCerrando servidor...');
    console.log('Conexiones cerradas correctamente');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('Excepción no capturada:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promise rechazada no manejada:', reason);
    process.exit(1);
});

startServer();