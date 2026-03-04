package vn.dio.diennuoc;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.core.view.WindowCompat;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Không cho content vẽ vào phía sau status bar / notch
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
