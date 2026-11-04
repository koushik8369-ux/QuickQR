import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Scanner;

public class QuickQR {

    public static void main(String[] args) {
        displayWelcomeScreen();

        try (Scanner scanner = new Scanner(System.in)) {
            boolean running = true;
            while (running) {
                displayMenu();
                System.out.print("Select an option (1-3): ");

                if (!scanner.hasNextLine()) {
                    System.out.println("\nInput ended. Exiting QuickQR.");
                    break;
                }

                String choice = scanner.nextLine().trim();
                switch (choice) {
                    case "1" -> generateQrCode(scanner);
                    case "2" -> viewGeneratedQrCodes();
                    case "3" -> {
                        System.out.println("Thank you for using QuickQR. Goodbye!");
                        running = false;
                    }
                    default -> System.out.println("Invalid option. Please enter 1, 2, or 3.");
                }
            }
        }
    }

    private static void displayWelcomeScreen() {
        System.out.println("==============================================");
        System.out.println("   QUICKQR - TEXT TO QR CODE GENERATOR");
        System.out.println("==============================================");
        System.out.println("Welcome! Choose an option to get started.");
    }

    private static void displayMenu() {
        System.out.println();
        System.out.println("1. Generate QR Code");
        System.out.println("2. View Generated QR Codes");
        System.out.println("3. Exit");
    }

    private static void generateQrCode(Scanner scanner) {
        System.out.print("Enter a message or text for the QR code: ");
        if (!scanner.hasNextLine()) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }

        String message = scanner.nextLine();
        if (message.trim().isEmpty()) {
            System.out.println("The message cannot be empty. Returning to the main menu.");
            return;
        }

        System.out.print("Enter a filename (leave blank for message): ");
        if (!scanner.hasNextLine()) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }

        String fileName = scanner.nextLine().trim();
        if (fileName.isEmpty()) {
            fileName = "message";
        }
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".png")) {
            fileName += ".png";
        }

        if (fileName.equals(".") || fileName.equals("..")
                || fileName.endsWith(" ")
                || fileName.chars().anyMatch(character ->
                character < 32 || "<>:\"/\\|?*".indexOf(character) >= 0)) {
            System.out.println("Invalid filename. Use a simple filename without reserved characters.");
            return;
        }

        try {
            Path outputDirectory = Path.of("generated-qr");
            Path outputFile = outputDirectory.resolve(fileName);
            if (Files.exists(outputFile)) {
                System.out.println("A file with that name already exists: "
                        + outputFile.toAbsolutePath().normalize());
                return;
            }

            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            // UTF-8 lets the QR code represent text beyond basic ASCII when supported.
            hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
            // Keep the output dimensions at the requested 300 by 300 pixels.
            BitMatrix qrCode = new QRCodeWriter().encode(
                    message, BarcodeFormat.QR_CODE, 300, 300, hints);

            Files.createDirectories(outputDirectory);
            MatrixToImageWriter.writeToPath(qrCode, "PNG", outputFile);
            System.out.println("QR code generated successfully: "
                    + outputFile.toAbsolutePath().normalize());
        } catch (InvalidPathException exception) {
            System.out.println("Invalid filename: " + exception.getMessage());
        } catch (WriterException exception) {
            System.out.println("The message could not be encoded as a QR code: "
                    + exception.getMessage());
        } catch (IOException exception) {
            System.out.println("Unable to save the QR code: " + exception.getMessage());
        } catch (SecurityException exception) {
            System.out.println("Permission denied while saving the QR code: " + exception.getMessage());
        } catch (IllegalArgumentException exception) {
            System.out.println("Invalid QR code input: " + exception.getMessage());
        }
    }

    private static void viewGeneratedQrCodes() {
        System.out.println("Viewing generated QR codes will be available in a future step.");
    }
}
