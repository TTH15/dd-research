const CONFIG = {
    // Supabase プロジェクト設定
    supabase: {
        projectUrl: 'https://fwmieqfezlagstigtrem.supabase.co',  // SupabaseプロジェクトURL
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bWllcWZlemxhZ3N0aWd0cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NjM1MjIsImV4cCI6MjA3NzIzOTUyMn0.YytgJyhjThVCGw1FE3lbGLz2GEAE4ljyJt5_mdZTV8E',            // Supabase Anon/Public Key
        tableName: 'products_dd'                   // 使用するテーブル名
    },

    // Keepa Edge Function 設定
    // JAN→ASIN候補の自動取得・利益計算に使用
    keepa: {
        functionUrl: 'https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-fetch',
        functionKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bWllcWZlemxhZ3N0aWd0cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NjM1MjIsImV4cCI6MjA3NzIzOTUyMn0.YytgJyhjThVCGw1FE3lbGLz2GEAE4ljyJt5_mdZTV8E'  // Anon Keyで可（RLSで保護）
    }
};
