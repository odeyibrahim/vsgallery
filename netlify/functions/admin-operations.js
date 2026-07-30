import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

function getClientIp(event) {
    const fwd = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
    return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        let requestBody = {};
        try {
            requestBody = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
        }

        const adminToken = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
        const { operation, data } = requestBody;

        // ============================================================
        // LOGIN — fails closed if ADMIN_PASSWORD_HASH isn't configured.
        // No "demo mode" fallback: an unset hash is a configuration
        // error, not an open door.
        // ============================================================
        if (operation === 'login') {
            const clientIp = getClientIp(event);

            const { data: recentFailures } = await supabase.rpc('count_recent_failed_logins', {
                p_ip: clientIp,
                p_minutes: LOCKOUT_WINDOW_MINUTES
            });

            if ((recentFailures || 0) >= MAX_FAILED_ATTEMPTS) {
                return {
                    statusCode: 429,
                    headers,
                    body: JSON.stringify({ error: `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.` })
                };
            }

            const configuredHash = process.env.ADMIN_PASSWORD_HASH;
            if (!configuredHash) {
                console.error('ADMIN_PASSWORD_HASH is not set — refusing all admin logins.');
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Admin login is not configured. Set ADMIN_PASSWORD_HASH.' })
                };
            }

            const { password } = data || {};
            if (!password) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Password required' }) };
            }

            const isValid = bcrypt.compareSync(password, configuredHash);

            await supabase.from('login_attempts').insert({ ip_address: clientIp, success: isValid });

            if (!isValid) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid password' }) };
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            const { error: insertError } = await supabase
                .from('admin_sessions')
                .insert({ token, expires_at: expiresAt.toISOString() });

            if (insertError) {
                console.error('Session insert error:', insertError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create session' }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true, token }) };
        }

        // ============================================================
        // Every other operation requires a valid, unexpired session.
        // ============================================================
        if (!adminToken) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin authentication required' }) };
        }

        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('*')
            .eq('token', adminToken)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (sessionError || !session) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired admin session' }) };
        }

        let result;

        switch (operation) {
            case 'get_stats': {
                const [ordersResult, revenueResult, productsResult, customersResult] = await Promise.all([
                    supabase.from('orders').select('*', { count: 'exact', head: true }),
                    supabase.from('orders').select('total_amount').eq('payment_status', 'paid'),
                    supabase.from('products').select('*', { count: 'exact', head: true }),
                    supabase.from('customers').select('*', { count: 'exact', head: true })
                ]);

                const revenue = revenueResult.data || [];
                const totalRevenue = revenue.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

                result = {
                    totalRevenue,
                    totalOrders: ordersResult.count || 0,
                    totalProducts: productsResult.count || 0,
                    totalCustomers: customersResult.count || 0
                };
                break;
            }

            case 'get_products': {
                const { data: products } = await supabase
                    .from('products')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = products || [];
                break;
            }

            case 'create_product': {
                const newProductId = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                const { data: newProduct, error: createError } = await supabase
                    .from('products')
                    .insert({
                        product_id: newProductId,
                        title: data.title,
                        author: data.author || 'V.',
                        description: data.description || '',
                        type: data.type || 'merch',
                        base_price: parseFloat(data.base_price) || 0,
                        stock: parseInt(data.stock) || 0,
                        orientation: data.orientation || 'square',
                        image_url: data.image_url || '',
                        variations: data.variations || [],
                        is_active: true
                    })
                    .select()
                    .single();

                if (createError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: createError.message }) };
                }
                result = newProduct;
                break;
            }

            case 'update_product': {
                const { data: updatedProduct, error: updateError } = await supabase
                    .from('products')
                    .update({
                        title: data.title,
                        author: data.author,
                        description: data.description,
                        type: data.type,
                        base_price: parseFloat(data.base_price),
                        stock: parseInt(data.stock),
                        orientation: data.orientation,
                        image_url: data.image_url,
                        variations: data.variations,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', data.id)
                    .select()
                    .single();

                if (updateError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: updateError.message }) };
                }
                result = updatedProduct;
                break;
            }

            case 'delete_product': {
                await supabase.from('products').update({ is_active: false }).eq('id', data.id);
                result = { success: true };
                break;
            }

            case 'get_orders': {
                const { data: orders } = await supabase
                    .from('orders')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = orders || [];
                break;
            }

            case 'update_order_status': {
                await supabase
                    .from('orders')
                    .update({ order_status: data.status, updated_at: new Date().toISOString() })
                    .eq('id', data.id);
                result = { success: true };
                break;
            }

            // ------------------------------------------------------
            // Manual confirmation for bank/domiciliary transfers.
            // The admin has looked at the actual bank statement and
            // confirmed the money landed — this reuses the exact same
            // atomic, idempotent function the webhooks call, so stock
            // decrements and customer stats update consistently no
            // matter which payment path was used.
            // ------------------------------------------------------
            case 'confirm_bank_payment': {
                const { data: order } = await supabase
                    .from('orders')
                    .select('payment_reference, payment_provider')
                    .eq('id', data.id)
                    .single();

                if (!order) {
                    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
                }
                if (order.payment_provider !== 'bank_transfer') {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order was not placed as a bank transfer' }) };
                }

                const { data: confirmResult, error: confirmError } = await supabase.rpc('mark_order_paid', {
                    p_reference: order.payment_reference,
                    p_payment_method: 'bank_transfer',
                    p_transaction_id: `admin-confirmed-${adminToken.slice(0, 8)}`
                });

                if (confirmError || !confirmResult?.success) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: confirmError?.message || 'Failed to confirm payment' }) };
                }
                result = confirmResult;
                break;
            }

            case 'get_customers': {
                const { data: customers } = await supabase
                    .from('customers')
                    .select('*')
                    .order('total_spent', { ascending: false });
                result = customers || [];
                break;
            }

            default:
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid operation: ' + operation }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (error) {
        console.error('Admin error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Operation failed: ' + error.message }) };
    }
};
